/**
 * Headers that apply to every response, including static assets served without middleware.
 * Dependency-free so next.config.ts can import it. The per-request CSP (with a nonce) is
 * added by src/middleware.ts.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(self \"https://js.stripe.com\" \"https://checkout.razorpay.com\")",
  },
];

/** Two years, subdomains, preload-eligible. Only sent in production (HTTPS). */
export const HSTS_HEADER = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" };
