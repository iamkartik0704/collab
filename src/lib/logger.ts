import pino, { type Logger } from "pino";
import { env } from "@/env";

if (typeof window !== "undefined") {
  throw new Error("@/lib/logger is server-only and must not be imported from client code.");
}

/**
 * Structured JSON logger shared by the Next.js server and the BullMQ worker.
 * Output is plain JSON on stdout (no worker-thread transports, which break under the
 * Next.js bundler). Pipe through `pino-pretty` locally for readable output.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL ?? "info",
  base: {
    service: process.env.SERVICE_NAME ?? "collab-web",
    env: env.NODE_ENV ?? "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "accessToken",
      "refreshToken",
      "*.accessToken",
      "*.refreshToken",
      "otp",
      "*.otp",
      "code",
      "*.code",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "cardNumber",
      "*.cardNumber",
      "cvv",
      "*.cvv",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
