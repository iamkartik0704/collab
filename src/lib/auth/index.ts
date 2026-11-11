import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { env } from "@/env";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getClientIp, getUserAgent } from "@/lib/security/request";
import { mergeGuestCart } from "@/server/cart/cart.service";
import { authConfig } from "./config";
import { ACCESS_TOKEN_TTL_SECONDS, GUEST_CART_COOKIE_NAME, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, refreshCookieOptions } from "./cookies";
import { OtpVerificationError, verifyOtp } from "./otp";
import { issueRefreshToken, revokeRefreshFamily } from "./refresh-tokens";

class OtpInvalidCode extends CredentialsSignin {
  override code = "invalid_code";
}
class OtpRateLimited extends CredentialsSignin {
  override code = "rate_limited";
}
class AccountDisabled extends CredentialsSignin {
  override code = "account_disabled";
}

const otpCredentialsSchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  target: z.string().min(3).max(320),
  code: z.string().regex(/^\d{6}$/),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // The adapter only persists Users/Accounts for Google sign-in; sessions are JWTs.
  adapter: PrismaAdapter(db as unknown as PrismaClient),
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Safe because sign-in is refused below unless Google reports the email as verified,
      // and email-OTP accounts have proven ownership of the same address.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      id: "otp",
      name: "One-time code",
      credentials: { channel: {}, target: {}, code: {} },
      async authorize(credentials, request) {
        const parsed = otpCredentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          throw new OtpInvalidCode();
        }
        try {
          const user = await verifyOtp({ ...parsed.data, ip: getClientIp(request.headers) });
          return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role };
        } catch (error) {
          if (error instanceof OtpVerificationError) {
            if (error.reason === "rate_limited") throw new OtpRateLimited();
            if (error.reason === "inactive") throw new AccountDisabled();
            throw new OtpInvalidCode();
          }
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        if (profile?.email_verified !== true || !profile.email) {
          return false;
        }
        const existing = await db.user.findUnique({
          where: { email: profile.email.toLowerCase() },
          select: { isActive: true },
        });
        if (existing && !existing.isActive) {
          return false;
        }
      }
      return Boolean(user);
    },

    /**
     * Runs on sign-in (with `user`) and on every session read. Sign-in starts a refresh-token
     * family and stamps the access-token claims. Client-initiated `update()` calls are ignored:
     * claims only change through /api/auth/refresh, which re-reads the database.
     */
    async jwt({ token, user }) {
      if (user?.id) {
        const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, isActive: true } });
        if (!dbUser?.isActive) {
          return null;
        }
        const requestHeaders = await headers();
        const issued = await issueRefreshToken(dbUser.id, {
          ip: getClientIp(requestHeaders),
          userAgent: getUserAgent(requestHeaders),
        });
        (await cookies()).set(REFRESH_COOKIE_NAME, issued.token, refreshCookieOptions());
        return {
          ...token,
          sub: dbUser.id,
          uid: dbUser.id,
          role: dbUser.role,
          sid: issued.familyId,
          accessExp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
        };
      }
      return token;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch((error: unknown) => {
        logger.warn({ err: error }, "failed to record lastLoginAt");
      });
      const cookieStore = await cookies();
      const guestToken = cookieStore.get(GUEST_CART_COOKIE_NAME)?.value;
      if (guestToken) {
        try {
          await mergeGuestCart(guestToken, user.id);
          cookieStore.delete(GUEST_CART_COOKIE_NAME);
        } catch (error) {
          logger.error({ err: error, userId: user.id }, "guest cart merge failed");
        }
      }
    },
    async signOut(message) {
      if ("token" in message && message.token?.sid) {
        await revokeRefreshFamily(message.token.sid, "signed_out");
      }
      (await cookies()).set(REFRESH_COOKIE_NAME, "", { ...refreshCookieOptions(0), path: REFRESH_COOKIE_PATH });
    },
  },
});
