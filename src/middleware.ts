import { randomUUID } from "node:crypto";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";
import { hasPermission, requiredPermissionForPath, requiresAuthentication } from "@/lib/auth/rbac";
import { applySecurityHeaders, buildContentSecurityPolicy } from "@/lib/security/headers";
import { isSameOriginRequest } from "@/lib/security/request";

/**
 * Edge of the application (Node.js runtime, no database access):
 *  1. CSRF: state-changing /api requests must originate from our own origin.
 *  2. Authentication gate for /account, /checkout and /admin (+ /api/admin).
 *  3. RBAC: admin paths require the permission mapped in rbac.ts.
 *  4. Per-request CSP nonce + security headers + request id on every response.
 * Authorisation is re-checked server-side (requireUser / requirePermission) - this layer is
 * defence in depth and fast rejection, not the only check.
 */

const { auth } = NextAuth(authConfig);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Endpoints called by third parties (signature-verified) or by Auth.js itself (CSRF token). */
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/", "/api/auth/callback/", "/api/auth/signin", "/api/auth/signout"];

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export default auth((request) => {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(nonce);
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  const finish = (response: NextResponse): NextResponse => {
    applySecurityHeaders(response.headers, csp, requestId);
    return response;
  };

  // 1. CSRF
  if (
    isApi &&
    !SAFE_METHODS.has(request.method) &&
    !CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !isSameOriginRequest(request.headers)
  ) {
    return finish(jsonError(403, "csrf_rejected", "Cross-origin request rejected."));
  }

  // 2 + 3. Authentication and RBAC
  const permission = requiredPermissionForPath(pathname);
  if (permission !== null || requiresAuthentication(pathname)) {
    const session = request.auth;
    const callbackUrl = `${pathname}${search}`;

    if (!session?.user?.id) {
      if (isApi) return finish(jsonError(401, "unauthorized", "Sign in to continue."));
      const login = new URL("/login", request.nextUrl.origin);
      login.searchParams.set("callbackUrl", callbackUrl);
      return finish(NextResponse.redirect(login));
    }

    if (session.accessExpiresAt * 1000 <= Date.now()) {
      if (isApi) return finish(jsonError(401, "token_expired", "Your session needs refreshing."));
      const refresh = new URL("/api/auth/refresh", request.nextUrl.origin);
      refresh.searchParams.set("callbackUrl", callbackUrl);
      return finish(NextResponse.redirect(refresh));
    }

    if (permission !== null && !hasPermission(session.user.role, permission)) {
      if (isApi) return finish(jsonError(403, "forbidden", "You do not have permission to do that."));
      // Staff without this particular permission go back to their dashboard (same as the page guard).
      const fallback = hasPermission(session.user.role, "admin:access") ? "/admin?denied=1" : "/";
      return finish(NextResponse.redirect(new URL(fallback, request.nextUrl.origin)));
    }
  }

  // 4. Forward nonce + request id to the app; Next.js reads the nonce from the CSP header.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", csp);
  return finish(NextResponse.next({ request: { headers: requestHeaders } }));
});

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|txt)$).*)",
  ],
};
