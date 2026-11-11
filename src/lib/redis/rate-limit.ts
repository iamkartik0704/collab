import { createHash, randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { isRedisAvailable, LuaScript, redis, redisKey, withRedisTimeout } from "./client";

/**
 * Sliding-window-log rate limiter. One sorted set per (policy, identifier) holds the
 * timestamps of recent requests; the check-and-record runs atomically in Lua using the
 * Redis server clock, so all app instances share one consistent window.
 */

export interface RateLimitPolicy {
  /** Short stable name - part of the Redis key. */
  name: string;
  limit: number;
  windowMs: number;
  /**
   * Behaviour when Redis is unreachable:
   * - "closed": reject (abuse-sensitive endpoints: auth, checkout, AI).
   * - "open":   allow (public catalog reads must keep working).
   */
  failMode: "open" | "closed";
}

/** Limits from the platform spec. Identifier: IP for anonymous policies, user id otherwise. */
export const RateLimitPolicies = {
  /** Auth / OTP endpoints: 5 requests / 10 min / IP. */
  auth: { name: "auth", limit: 5, windowMs: 10 * 60_000, failMode: "closed" },
  /** Checkout and coupon validation: 15 requests / min / user. */
  checkout: { name: "checkout", limit: 15, windowMs: 60_000, failMode: "closed" },
  /** AI chatbot: 20 messages / 10 min / user. */
  aiChat: { name: "ai-chat", limit: 20, windowMs: 10 * 60_000, failMode: "closed" },
  /** Public API / catalog: 120 requests / min / IP. */
  publicApi: { name: "public-api", limit: 120, windowMs: 60_000, failMode: "open" },
  /** Admin portal mutations: 120 requests / min / staff user. */
  adminWrite: { name: "admin-write", limit: 120, windowMs: 60_000, failMode: "open" },
} as const satisfies Record<string, RateLimitPolicy>;

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the oldest counted request leaves the window. */
  resetAt: number;
  /** 0 when allowed; otherwise ms until a retry can succeed. */
  retryAfterMs: number;
  /** True when Redis was unavailable and `failMode` decided the outcome. */
  degraded: boolean;
}

const SLIDING_WINDOW = new LuaScript(
  "rate-limit-sliding-window",
  `
  -- KEYS[1] sorted set; ARGV[1] window ms, ARGV[2] limit, ARGV[3] unique nonce
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local window = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])

  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
  local count = redis.call('ZCARD', KEYS[1])
  local allowed = 0
  if count < limit then
    redis.call('ZADD', KEYS[1], now, now .. ':' .. ARGV[3])
    redis.call('PEXPIRE', KEYS[1], window)
    count = count + 1
    allowed = 1
  end

  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local resetAt = now + window
  if oldest[2] then
    resetAt = tonumber(oldest[2]) + window
  end
  return { allowed, limit - count, resetAt, now }
  `,
);

const DEGRADED_RETRY_AFTER_MS = 30_000;
const SCRIPT_TIMEOUT_MS = 500;

/**
 * Records one request for `identifier` under `policy` and reports whether it is allowed.
 * The identifier (IP or user id) is hashed before it reaches Redis.
 */
export async function rateLimit(policy: RateLimitPolicy, identifier: string): Promise<RateLimitResult> {
  if (identifier.length === 0) {
    throw new Error("rateLimit requires a non-empty identifier");
  }
  if (!Number.isInteger(policy.limit) || policy.limit < 1 || !Number.isInteger(policy.windowMs) || policy.windowMs < 1000) {
    throw new Error(`Invalid rate-limit policy "${policy.name}"`);
  }

  const key = redisKey("rl", policy.name, hashIdentifier(identifier));
  try {
    if (!isRedisAvailable()) {
      throw new Error("redis is unavailable");
    }
    const reply = await withRedisTimeout(
      SLIDING_WINDOW.run(redis, [key], [policy.windowMs, policy.limit, randomUUID()]),
      SCRIPT_TIMEOUT_MS,
      "rate-limit",
    );
    const [allowed, remaining, resetAt, now] = parseReply(reply);
    return {
      success: allowed === 1,
      limit: policy.limit,
      remaining: Math.max(0, remaining),
      resetAt,
      retryAfterMs: allowed === 1 ? 0 : Math.max(0, resetAt - now),
      degraded: false,
    };
  } catch (error) {
    logger.error({ err: error, policy: policy.name }, `rate limiter unavailable; failing ${policy.failMode}`);
    const now = Date.now();
    return policy.failMode === "open"
      ? { success: true, limit: policy.limit, remaining: policy.limit, resetAt: now + policy.windowMs, retryAfterMs: 0, degraded: true }
      : {
          success: false,
          limit: policy.limit,
          remaining: 0,
          resetAt: now + DEGRADED_RETRY_AFTER_MS,
          retryAfterMs: DEGRADED_RETRY_AFTER_MS,
          degraded: true,
        };
  }
}

/** IETF draft `RateLimit-*` headers plus `Retry-After` on rejection. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
  if (!result.success) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
  }
  return headers;
}

/** Clears an identifier's window, e.g. after a successful OTP verification. */
export async function resetRateLimit(policy: RateLimitPolicy, identifier: string): Promise<void> {
  await redis.unlink(redisKey("rl", policy.name, hashIdentifier(identifier)));
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex").slice(0, 32);
}

function parseReply(reply: unknown): [number, number, number, number] {
  if (!Array.isArray(reply) || reply.length !== 4 || !reply.every((value) => typeof value === "number")) {
    throw new Error("Unexpected rate-limit script reply");
  }
  return reply as [number, number, number, number];
}
