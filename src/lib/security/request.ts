import { env } from "@/env";

const APP_ORIGIN = new URL(env.APP_URL ?? "http://localhost:3000").origin;

/**
 * Client IP for rate limiting and audit logs.
 * Trust model: nginx overwrites `X-Real-IP` with `$remote_addr` (clients cannot spoof it).
 * Without a proxy (local dev) the right-most X-Forwarded-For hop is used.
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    const last = hops.at(-1);
    if (last) return last;
  }
  return "unknown";
}

export function getUserAgent(headers: Headers): string | undefined {
  return headers.get("user-agent")?.slice(0, 512) ?? undefined;
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the browser-supplied Origin
 * (or Sec-Fetch-Site when Origin is absent) must match the application's own origin.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin) {
    return origin === APP_ORIGIN;
  }
  const fetchSite = headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

/** Returns `value` only if it is a same-site relative path; prevents open redirects. */
export function safeRedirectPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  try {
    const url = new URL(value, APP_ORIGIN);
    return url.origin === APP_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function appOrigin(): string {
  return APP_ORIGIN;
}
