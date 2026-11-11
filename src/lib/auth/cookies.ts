import { env } from "@/env";

/** Secure cookies (and the __Secure- prefix) whenever the app is served over HTTPS. */
export const SECURE_COOKIES = new URL(env.APP_URL ?? "http://localhost:3000").protocol === "https:";

/** Auth.js JWT session cookie = short-lived access token. */
export const SESSION_COOKIE_NAME = SECURE_COOKIES ? "__Secure-authjs.session-token" : "authjs.session-token";

/** Rotating refresh token; only ever sent to /api/auth/*. */
export const REFRESH_COOKIE_NAME = SECURE_COOKIES ? "__Secure-collab.rt" : "collab.rt";
export const REFRESH_COOKIE_PATH = "/api/auth";

/** Guest cart token. */
export const GUEST_CART_COOKIE_NAME = SECURE_COOKIES ? "__Secure-collab.cart" : "collab.cart";

export const ACCESS_TOKEN_TTL_SECONDS = env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900;
export const REFRESH_TOKEN_TTL_SECONDS = (env.AUTH_REFRESH_TOKEN_TTL_DAYS ?? 30) * 24 * 60 * 60;

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(maxAge = REFRESH_TOKEN_TTL_SECONDS): CookieOptions {
  return { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/", maxAge };
}

export function refreshCookieOptions(maxAge = REFRESH_TOKEN_TTL_SECONDS): CookieOptions {
  return { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: REFRESH_COOKIE_PATH, maxAge };
}

export function guestCartCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 };
}
