import { createHash } from "node:crypto";
import Redis, { type RedisOptions } from "ioredis";
import { env } from "@/env";
import { logger } from "@/lib/logger";

if (typeof window !== "undefined") {
  throw new Error("@/lib/redis is server-only and must not be imported from client code.");
}

/**
 * Deployment model: a single Redis 7 primary (docker-compose `redis` service with AOF).
 * The cache-tag invalidation script touches keys that are discovered at run time, which is
 * valid on a standalone primary but not on Redis Cluster.
 */

const KEY_PREFIX = env.REDIS_KEY_PREFIX ?? "collab:";

/** Builds a namespaced key: redisKey("home", "bento") -> "collab:home:bento". */
export function redisKey(...parts: ReadonlyArray<string | number>): string {
  if (parts.length === 0) {
    throw new Error("redisKey requires at least one part");
  }
  return KEY_PREFIX + parts.join(":");
}

const BASE_OPTIONS: RedisOptions = {
  // Connect on first command, so importing this module during `next build` never dials out.
  lazyConnect: true,
  connectTimeout: 5_000,
  // Bound latency: storefront reads fall back to PostgreSQL rather than hang on Redis.
  commandTimeout: 2_000,
  maxRetriesPerRequest: 2,
  enableAutoPipelining: true,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  // Reconnect to the new primary after a failover instead of writing to a replica.
  reconnectOnError: (error) => error.message.startsWith("READONLY"),
};

function createRedisClient(connectionName: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, { ...BASE_OPTIONS, connectionName, ...overrides });
  let lastErrorLoggedAt = 0;
  client.on("error", (error: Error) => {
    // Reconnect loops emit an error per attempt; log at most one every 10s per connection.
    const now = Date.now();
    if (now - lastErrorLoggedAt > 10_000) {
      lastErrorLoggedAt = now;
      logger.error({ err: error, connectionName }, "redis connection error");
    }
  });
  client.on("ready", () => logger.debug({ connectionName }, "redis ready"));
  return client;
}

const globalForRedis = globalThis as unknown as { __collabRedis?: Redis };

/** Shared client for cache, rate limiting and locks. Do not use for BullMQ. */
export const redis: Redis = globalForRedis.__collabRedis ?? createRedisClient("collab-app");

if (env.NODE_ENV !== "production") {
  globalForRedis.__collabRedis = redis;
}

/**
 * Dedicated connection for BullMQ. BullMQ requires `maxRetriesPerRequest: null` and uses
 * blocking commands, so it must never share the latency-bounded app client.
 * - "producer": Queue instances inside request handlers; fail fast when Redis is down.
 * - "worker":   Worker / QueueEvents in the worker process; wait out outages.
 */
export function createBullMQConnection(role: "producer" | "worker", name: string): Redis {
  return createRedisClient(`collab-bullmq-${role}-${name}`, {
    maxRetriesPerRequest: null,
    commandTimeout: undefined,
    enableAutoPipelining: false,
    enableOfflineQueue: role === "worker",
    lazyConnect: role === "producer",
  });
}

/**
 * A Lua script executed with EVALSHA and transparently re-sent with EVAL when the
 * server's script cache is empty (after a restart or SCRIPT FLUSH).
 */
export class LuaScript {
  readonly sha: string;

  constructor(
    readonly name: string,
    readonly source: string,
  ) {
    this.sha = createHash("sha1").update(source).digest("hex");
  }

  async run(
    client: Redis,
    keys: readonly string[],
    args: ReadonlyArray<string | number>,
  ): Promise<unknown> {
    try {
      return await client.evalsha(this.sha, keys.length, ...keys, ...args);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("NOSCRIPT")) {
        return client.eval(this.source, keys.length, ...keys, ...args);
      }
      throw error;
    }
  }
}

const UNAVAILABLE_STATUSES = new Set(["reconnecting", "close", "end"]);

/**
 * Cheap circuit check: false while the client knows Redis is down, so callers can skip
 * Redis entirely instead of waiting for retries. ("wait" = not yet connected; the first
 * command triggers the connection and is bounded by a timeout.)
 */
export function isRedisAvailable(client: Redis = redis): boolean {
  return !UNAVAILABLE_STATUSES.has(client.status);
}

/** Rejects with a timeout error if `promise` does not settle within `ms`. */
export async function withRedisTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`redis operation "${label}" timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status === "end" || redis.status === "wait") {
    return;
  }
  await redis.quit();
}
