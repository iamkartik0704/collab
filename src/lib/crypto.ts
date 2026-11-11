import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

/** HMAC-SHA256 hex digest. Defaults to AUTH_TOKEN_PEPPER (for tokens / OTPs at rest). */
export function hmacSha256Hex(value: string | Buffer, key: string = env.AUTH_TOKEN_PEPPER): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two strings (false when lengths differ). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Random Crockford base32 string (no I, L, O, U) - readable order / ticket numbers. */
export function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CROCKFORD[bytes[i]! % 32];
  }
  return out;
}

/** JSON serialisation with sorted object keys, for request fingerprints. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}
