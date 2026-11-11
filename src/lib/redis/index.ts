/**
 * Redis toolkit - import everything from "@/lib/redis".
 *
 *   client.ts      ioredis singleton, BullMQ connection factory, Lua script runner, key builder
 *   cache.ts       Cache-Aside + Stale-While-Revalidate + tag invalidation
 *   rate-limit.ts  Sliding-window rate limiter with per-endpoint policies
 *   lock.ts        Distributed lock with fencing tokens and auto-renewal
 */
export {
  createBullMQConnection,
  disconnectRedis,
  isRedisAvailable,
  LuaScript,
  redis,
  redisKey,
  withRedisTimeout,
} from "./client";

export {
  cached,
  CacheKeys,
  CachePolicies,
  CacheTags,
  getTagVersions,
  hashedCacheKey,
  invalidateCacheKeys,
  invalidateCacheTags,
  readCache,
  writeCache,
  type CacheHit,
  type CacheOptions,
} from "./cache";

export {
  rateLimit,
  rateLimitHeaders,
  RateLimitPolicies,
  resetRateLimit,
  type RateLimitPolicy,
  type RateLimitResult,
} from "./rate-limit";

export {
  acquireLock,
  LockAcquisitionError,
  LockLostError,
  withLock,
  type Lock,
  type LockOptions,
  type WithLockContext,
} from "./lock";
