import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Single source of truth for configuration. Imported by the Next.js app and the
 * BullMQ worker; both fail fast at boot if anything is missing or malformed.
 *
 * Server variables are never bundled for the browser; touching one from client code
 * throws. Only NEXT_PUBLIC_* variables are exposed to the client.
 */

/** Must equal the `vector(1024)` column type in prisma/schema.prisma. */
export const EMBEDDING_DIMENSIONS = 1024;

const E164 = /^\+[1-9]\d{7,14}$/;

const bool = z.stringbool();

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .pipe(z.array(item).min(1));

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url({ protocol: /^https?$/ }),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

    // Database
    DATABASE_URL: postgresUrl,
    DIRECT_DATABASE_URL: postgresUrl,

    // Redis
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    REDIS_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9_-]+:$/, "must be lowercase and end with ':' (e.g. collab:)")
      .default("collab:"),

    // Auth
    AUTH_SECRET: z.string().min(32),
    AUTH_URL: z.url().optional(),
    AUTH_TRUST_HOST: bool.default(false),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_TOKEN_PEPPER: z.string().min(32),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

    // Payments
    STRIPE_SECRET_KEY: z.string().regex(/^sk_(test|live)_/, "must start with sk_test_ or sk_live_"),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
    RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_/, "must start with rzp_test_ or rzp_live_"),
    RAZORPAY_KEY_SECRET: z.string().min(1),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
    DEFAULT_CURRENCY: z.enum(["INR", "USD"]).default("INR"),

    // Object storage
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(3).max(63),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }),
    S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

    // WhatsApp Business Cloud API
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
    WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().regex(/^\d+$/),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1),
    WHATSAPP_APP_SECRET: z.string().min(1),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16),

    // Email
    /** "log" prints messages instead of sending them (development / tests only). */
    EMAIL_PROVIDER: z.enum(["resend", "smtp", "log"]).default("resend"),
    EMAIL_FROM: z.string().regex(/^.+<[^\s@]+@[^\s@]+\.[^\s@]+>$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
      message: 'must be an address or "Name <address>"',
    }),
    EMAIL_REPLY_TO: z.email().optional(),
    RESEND_API_KEY: z.string().startsWith("re_").optional(),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    /** Workers log WhatsApp / email deliveries instead of calling the providers (dev / CI only). */
    NOTIFICATIONS_DRY_RUN: bool.default(false),

    // GST tax invoices (printed on every PDF invoice)
    INVOICE_SELLER_NAME: z.string().min(2).max(120).default("Collab Retail Private Limited"),
    INVOICE_SELLER_ADDRESS: z.string().min(5).max(300).default("12 Residency Road, Bengaluru, Karnataka 560025, India"),
    /** Indian state of the shipping-from address: same state = CGST + SGST, otherwise IGST. */
    INVOICE_SELLER_STATE: z.string().min(2).max(60).default("Karnataka"),
    INVOICE_SELLER_GSTIN: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "must be a 15-character GSTIN").optional(),

    // AI
    ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
    AI_CHAT_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
    VOYAGE_API_KEY: z.string().min(1),
    AI_EMBEDDING_MODEL: z.string().min(1).default("voyage-3.5"),
    AI_EMBEDDING_DIMENSIONS: z.coerce
      .number()
      .int()
      .refine((value) => value === EMBEDDING_DIMENSIONS, {
        message: `must be ${EMBEDDING_DIMENSIONS} to match vector(${EMBEDDING_DIMENSIONS}) in prisma/schema.prisma`,
      })
      .default(EMBEDDING_DIMENSIONS),

    // Operations
    ADMIN_ALERT_EMAILS: csv(z.email()),
    ADMIN_ALERT_WHATSAPP_NUMBERS: csv(z.string().regex(E164, "must be E.164, e.g. +919800000000")),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.url({ protocol: /^https?$/ }),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
      .string()
      .regex(/^pk_(test|live)_/, "must start with pk_test_ or pk_live_"),
    NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_/),
  },

  // Server variables are read from process.env directly; only client variables must be
  // listed so Next.js can inline them into the browser bundle.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  },

  skipValidation: isTruthy(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});

/**
 * Invariants spanning several variables, which per-key schemas cannot express.
 * Runs once on the server at module load (never in the browser bundle).
 */
function assertCrossFieldInvariants(): void {
  const problems: string[] = [];

  if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
    problems.push("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
  }
  if (env.EMAIL_PROVIDER === "smtp" && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD)) {
    problems.push("SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required when EMAIL_PROVIDER=smtp");
  }

  if (env.NODE_ENV === "production" && (env.EMAIL_PROVIDER === "log" || env.NOTIFICATIONS_DRY_RUN) && !isTruthy(process.env.ALLOW_DRY_RUN_IN_PRODUCTION)) {
    problems.push("EMAIL_PROVIDER=log and NOTIFICATIONS_DRY_RUN are for development only (set ALLOW_DRY_RUN_IN_PRODUCTION=1 for a production-mode test build)");
  }

  if (new URL(env.APP_URL).origin !== new URL(env.NEXT_PUBLIC_APP_URL).origin) {
    problems.push("APP_URL and NEXT_PUBLIC_APP_URL must have the same origin");
  }
  const appUrl = new URL(env.APP_URL);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname);
  if (env.NODE_ENV === "production" && appUrl.protocol !== "https:" && !isLoopback) {
    problems.push("APP_URL must use https in production (http is only allowed for localhost)");
  }

  const stripeSecretMode = env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
  const stripePublicMode = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith("pk_live_") ? "live" : "test";
  if (stripeSecretMode !== stripePublicMode) {
    problems.push("STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are from different modes (test/live)");
  }
  if (env.RAZORPAY_KEY_ID !== env.NEXT_PUBLIC_RAZORPAY_KEY_ID) {
    problems.push("NEXT_PUBLIC_RAZORPAY_KEY_ID must equal RAZORPAY_KEY_ID");
  }

  if (env.AUTH_TOKEN_PEPPER === env.AUTH_SECRET) {
    problems.push("AUTH_TOKEN_PEPPER must differ from AUTH_SECRET");
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${problems.join("\n  - ")}`);
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

if (typeof window === "undefined" && !isTruthy(process.env.SKIP_ENV_VALIDATION)) {
  assertCrossFieldInvariants();
}
