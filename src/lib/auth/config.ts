import type { NextAuthConfig } from "next-auth";
import { env } from "@/env";
import { REFRESH_TOKEN_TTL_SECONDS, SECURE_COOKIES, SESSION_COOKIE_NAME } from "./cookies";

/**
 * Database-free Auth.js configuration. Used as-is by the middleware (which only decodes the
 * session JWT) and extended with the Prisma adapter + providers in ./index.ts.
 *
 * Token model:
 * - The session JWT is the ACCESS token. Its `accessExp` claim (AUTH_ACCESS_TOKEN_TTL_SECONDS,
 *   default 15 min) - not the cookie lifetime - decides whether it is still valid.
 * - A rotating REFRESH token (separate HttpOnly cookie, path /api/auth) re-issues it via
 *   /api/auth/refresh, re-reading role + active status from the database each time.
 */
export const authConfig = {
  secret: env.AUTH_SECRET,
  trustHost: env.AUTH_TRUST_HOST ?? false,
  session: {
    strategy: "jwt",
    // Cookie lifetime; access validity is enforced by `accessExp`.
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: SECURE_COOKIES },
    },
  },
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (token.uid && token.role) {
        session.user.id = token.uid;
        session.user.role = token.role;
      }
      session.accessExpiresAt = token.accessExp ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
