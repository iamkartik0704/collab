import { encode } from "next-auth/jwt";
import { env } from "@/env";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, SESSION_COOKIE_NAME } from "./cookies";
import type { SessionUser } from "./refresh-tokens";

/**
 * Encodes an Auth.js-compatible session JWT (the access token) outside the Auth.js request
 * cycle - used by /api/auth/refresh. The salt must equal the session cookie name.
 */
export async function encodeAccessToken(
  user: SessionUser,
  familyId: string,
): Promise<{ value: string; accessExp: number }> {
  const accessExp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  const value = await encode({
    secret: env.AUTH_SECRET,
    salt: SESSION_COOKIE_NAME,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
    token: {
      sub: user.id,
      name: user.name,
      email: user.email,
      picture: user.image,
      uid: user.id,
      role: user.role,
      sid: familyId,
      accessExp,
    },
  });
  return { value, accessExp };
}
