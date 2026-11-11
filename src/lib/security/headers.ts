import { env } from "@/env";
import { s3UploadOrigin } from "@/lib/storage/origin";
import { HSTS_HEADER, STATIC_SECURITY_HEADERS } from "./static-headers";

const STRIPE = ["https://js.stripe.com", "https://*.js.stripe.com"];
const RAZORPAY = ["https://checkout.razorpay.com", "https://api.razorpay.com"];

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Strict nonce-based CSP. `strict-dynamic` lets nonce'd Next.js scripts load their chunks while
 * blocking injected inline scripts. Payment providers are allow-listed explicitly.
 */
export function buildContentSecurityPolicy(nonce: string): string {
  const isDev = env.NODE_ENV !== "production";
  const cdn = originOf(env.S3_PUBLIC_BASE_URL);
  // Admin image uploads go straight from the browser to the bucket (presigned POST).
  const uploads = env.S3_BUCKET
    ? s3UploadOrigin({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, region: env.S3_REGION ?? "auto", forcePathStyle: env.S3_FORCE_PATH_STYLE ?? false })
    : null;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...STRIPE, "https://checkout.razorpay.com", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://*.stripe.com", "https://lh3.googleusercontent.com", ...(cdn ? [cdn] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://api.stripe.com",
      "https://lumberjack.razorpay.com",
      ...RAZORPAY,
      ...(uploads ? [uploads] : []),
      ...(isDev ? ["ws:", "wss:"] : []),
    ],
    "frame-src": [...STRIPE, "https://hooks.stripe.com", ...RAZORPAY],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https://accounts.google.com"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
  // Only meaningful (and only safe) when the site itself is served over HTTPS; on an http
  // origin (local production build) it would rewrite same-origin redirects to https.
  const servedOverHttps = originOf(env.APP_URL)?.startsWith("https://") ?? false;
  return servedOverHttps ? `${policy}; upgrade-insecure-requests` : policy;
}

/** Applies CSP + static security headers (+ HSTS in production) to a response. */
export function applySecurityHeaders(headers: Headers, csp: string, requestId: string): void {
  headers.set("Content-Security-Policy", csp);
  for (const { key, value } of STATIC_SECURITY_HEADERS) {
    headers.set(key, value);
  }
  if (env.NODE_ENV === "production") {
    headers.set(HSTS_HEADER.key, HSTS_HEADER.value);
  }
  headers.set("x-request-id", requestId);
}
