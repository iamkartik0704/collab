import { NextResponse, type NextRequest } from "next/server";
import { Errors } from "@/lib/api/errors";
import { enforceRateLimit, json, route } from "@/lib/api/handler";
import { encodeAccessToken } from "@/lib/auth/access-token";
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { rotateRefreshToken, type RotationResult } from "@/lib/auth/refresh-tokens";
import type { RateLimitPolicy } from "@/lib/redis";
import { appOrigin, getClientIp, getUserAgent, safeRedirectPath } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const REFRESH_POLICY: RateLimitPolicy = { name: "auth-refresh", limit: 30, windowMs: 60_000, failMode: "open" };

async function rotate(request: NextRequest): Promise<RotationResult | null> {
  await enforceRateLimit(REFRESH_POLICY, getClientIp(request.headers));
  const raw = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!raw) return null;
  return rotateRefreshToken(raw, { ip: getClientIp(request.headers), userAgent: getUserAgent(request.headers) });
}

function setSessionCookies(response: NextResponse, accessToken: string, refreshToken: string): void {
  response.cookies.set(SESSION_COOKIE_NAME, accessToken, sessionCookieOptions());
  response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
}

function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
  response.cookies.set(REFRESH_COOKIE_NAME, "", { ...refreshCookieOptions(0), path: REFRESH_COOKIE_PATH });
}

/**
 * GET /api/auth/refresh?callbackUrl=/account - page navigations. Middleware redirects here
 * when the access token has expired; on success we bounce back to the (same-origin) callback.
 */
export const GET = route(async (request) => {
  const callbackUrl = safeRedirectPath(request.nextUrl.searchParams.get("callbackUrl"), "/");
  const result = await rotate(request);

  if (result?.ok) {
    const access = await encodeAccessToken(result.user, result.issued.familyId);
    const response = NextResponse.redirect(new URL(callbackUrl, appOrigin()));
    setSessionCookies(response, access.value, result.issued.token);
    return response;
  }
  if (result && result.reason === "concurrent") {
    // Another tab just rotated; the browser already holds the new cookies.
    return NextResponse.redirect(new URL(callbackUrl, appOrigin()));
  }
  const login = new URL("/login", appOrigin());
  login.searchParams.set("callbackUrl", callbackUrl);
  login.searchParams.set("reason", "session_expired");
  const response = NextResponse.redirect(login);
  clearSessionCookies(response);
  return response;
});

/** POST /api/auth/refresh - fetch() clients after a 401 token_expired. */
export const POST = route(async (request) => {
  const result = await rotate(request);
  if (result?.ok) {
    const access = await encodeAccessToken(result.user, result.issued.familyId);
    const response = json({ refreshed: true, accessExpiresAt: access.accessExp });
    setSessionCookies(response, access.value, result.issued.token);
    return response;
  }
  if (result && result.reason === "concurrent") {
    throw Errors.conflict("refresh_in_progress", "Session refresh already in progress. Retry the original request.");
  }
  const failure = json({ error: { code: "session_expired", message: "Please sign in again." } }, { status: 401 });
  clearSessionCookies(failure);
  return failure;
});
