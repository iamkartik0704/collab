import { createHash } from "node:crypto";
import SuperJSON from "superjson";
import { logger } from "@/lib/logger";
import { isRedisAvailable, LuaScript, redis, redisKey, withRedisTimeout } from "./client";
import { acquireLock } from "./lock";

/**
 * Cache-Aside with Stale-While-Revalidate and tag-based invalidation.
 *
 * - Values are stored as SuperJSON (Dates, BigInt, Maps survive the round trip).
 * - Each entry lives for `ttlSeconds + staleWhileRevalidateSeconds`. After `ttlSeconds` it
 *   is served stale while one instance refreshes it in the background.
 * - Tags map to Redis sets of cache keys. `invalidateCacheTags` deletes every member and
 *   bumps a per-tag version. A fill that started before an invalidation sees the version
 *   change and skips its write, so a stale DB read can never overwrite fresher data.
 * - Misses are single-flighted: in-process via a promise map, cross-instance via a lock.
 * - Redis failures never fail the request: reads fall through to the loader.
 */

export interface CacheOptions {
  /** Seconds the entry is fresh. */
  ttlSeconds: number;
  /** Extra seconds a stale entry may be served while it is refreshed. Default 0. */
  staleWhileRevalidateSeconds?: number;
  /** Tags used for invalidation, e.g. CacheTags.product(id). */
  tags?: readonly string[];
}

export interface CacheHit<T> {
  value: T;
  isStale: boolean;
}

interface Envelope {
  /** Epoch ms after which the entry is stale. */
  f: number;
  /** SuperJSON-serialised value. */
  d: ReturnType<typeof SuperJSON.serialize>;
}

const READ_TIMEOUT_MS = 250;
const FILL_SETUP_TIMEOUT_MS = 500;
const FILL_LOCK_TTL_MS = 10_000;
const REFRESH_LOCK_TTL_MS = 30_000;
const FILL_WAIT_ATTEMPTS = 6;
const TAG_VERSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TAGS_PER_ENTRY = 32;

/** Spec-mandated policies. */
export const CachePolicies = {
  catalog: { ttlSeconds: 300, staleWhileRevalidateSeconds: 60 },
  home: { ttlSeconds: 600, staleWhileRevalidateSeconds: 120 },
  product: { ttlSeconds: 300, staleWhileRevalidateSeconds: 60 },
} as const satisfies Record<string, Omit<CacheOptions, "tags">>;

export const CacheTags = {
  product: (productId: string) => `product:${productId}`,
  category: (categorySlug: string) => `category:${categorySlug}`,
  brand: (brandSlug: string) => `brand:${brandSlug}`,
  /** Any home-page aggregation. */
  home: () => "home",
  /** Any catalog listing / facet result. */
  catalog: () => "catalog",
} as const;

export const CacheKeys = {
  /** collab:catalog:{hash} - listing page for a normalised filter/sort/page query. */
  catalog: (query: unknown) => hashedCacheKey("catalog", query),
  /** collab:facets:{hash} - facet counts for a category + filter combination. */
  facets: (query: unknown) => hashedCacheKey("facets", query),
  /** collab:product:{slug} - product detail page payload. */
  product: (slug: string) => redisKey("product", slug),
  homeBento: () => redisKey("home", "bento"),
  homeTabs: () => redisKey("home", "tabs"),
} as const;

const tagSetKey = (tag: string) => redisKey("tag", tag);
const tagVersionKey = (tag: string) => redisKey("tagv", tag);

const WRITE_WITH_TAGS = new LuaScript(
  "cache-write-with-tags",
  `
  -- KEYS[1]             cache key
  -- KEYS[2 .. n+1]      tag set keys
  -- KEYS[n+2 .. 2n+1]   tag version keys
  -- ARGV[1] payload, ARGV[2] ttl ms, ARGV[3] n, ARGV[4 .. n+3] expected versions ('' = none)
  local n = tonumber(ARGV[3])
  for i = 1, n do
    local current = redis.call('GET', KEYS[n + 1 + i]) or ''
    if current ~= ARGV[3 + i] then
      return 0
    end
  end
  local ttl = tonumber(ARGV[2])
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
  for i = 1, n do
    local tagKey = KEYS[1 + i]
    redis.call('SADD', tagKey, KEYS[1])
    if redis.call('PTTL', tagKey) < ttl then
      redis.call('PEXPIRE', tagKey, ttl)
    end
  end
  return 1
  `,
);

const INVALIDATE_TAGS = new LuaScript(
  "cache-invalidate-tags",
  `
  -- KEYS[1 .. n] tag set keys, KEYS[n+1 .. 2n] tag version keys
  -- ARGV[1] n, ARGV[2] version key ttl ms
  local n = tonumber(ARGV[1])
  local removed = 0
  for i = 1, n do
    redis.call('INCR', KEYS[n + i])
    redis.call('PEXPIRE', KEYS[n + i], ARGV[2])
    local members = redis.call('SMEMBERS', KEYS[i])
    for start = 1, #members, 500 do
      local batch = {}
      for j = start, math.min(start + 499, #members) do
        batch[#batch + 1] = members[j]
      end
      removed = removed + redis.call('UNLINK', unpack(batch))
    end
    redis.call('UNLINK', KEYS[i])
  end
  return removed
  `,
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the cached value for `key`, or loads it with `loader`, caches it and returns it.
 * Stale entries are returned immediately and refreshed in the background.
 */
export async function cached<T>(key: string, loader: () => Promise<T>, options: CacheOptions): Promise<T> {
  validateOptions(options);

  if (!isRedisAvailable()) {
    return loader();
  }

  const hit = await readCache<T>(key);
  if (hit) {
    if (hit.isStale) {
      scheduleBackgroundRefresh(key, loader, options);
    }
    return hit.value;
  }
  return singleFlight(key, () => fillOnMiss(key, loader, options));
}

/** Reads an entry. Resolves null on a miss or when Redis is unavailable. */
export async function readCache<T>(key: string): Promise<CacheHit<T> | null> {
  let raw: string | null;
  try {
    raw = await withRedisTimeout(redis.get(key), READ_TIMEOUT_MS, "cache-read");
  } catch (error) {
    logger.warn({ err: error, key }, "cache read failed; falling back to source");
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const envelope = JSON.parse(raw) as Envelope;
    return { value: SuperJSON.deserialize<T>(envelope.d), isStale: Date.now() > envelope.f };
  } catch (error) {
    // Corrupt or incompatible entry (e.g. after a deploy changed its shape): drop it.
    logger.warn({ err: error, key }, "discarding undecodable cache entry");
    void redis.unlink(key).catch(() => undefined);
    return null;
  }
}

/**
 * Writes an entry and registers it under its tags.
 * `expectedTagVersions` (from `getTagVersions`, captured before loading) makes the write a
 * no-op if any tag was invalidated meanwhile. Resolves whether the value was written.
 */
export async function writeCache<T>(
  key: string,
  value: T,
  options: CacheOptions,
  expectedTagVersions?: readonly string[],
): Promise<boolean> {
  validateOptions(options);
  const tags = uniqueTags(options.tags);
  const versions = expectedTagVersions ?? (await getTagVersions(tags));
  if (versions.length !== tags.length) {
    throw new Error("expectedTagVersions must have one entry per tag");
  }

  const ttlMs = (options.ttlSeconds + (options.staleWhileRevalidateSeconds ?? 0)) * 1000;
  const envelope: Envelope = { f: Date.now() + options.ttlSeconds * 1000, d: SuperJSON.serialize(value) };

  const result = await WRITE_WITH_TAGS.run(
    redis,
    [key, ...tags.map(tagSetKey), ...tags.map(tagVersionKey)],
    [JSON.stringify(envelope), ttlMs, tags.length, ...versions],
  );
  return Number(result) === 1;
}

/** Current version of each tag ('' when the tag has never been invalidated). */
export async function getTagVersions(tags: readonly string[]): Promise<string[]> {
  if (tags.length === 0) {
    return [];
  }
  const values = await redis.mget(...tags.map(tagVersionKey));
  return values.map((value) => value ?? "");
}

/**
 * Deletes every entry carrying any of `tags` (e.g. after an admin edits a price or stock).
 * Rejects if Redis is unavailable so the caller can retry (e.g. via a queued job);
 * entries expire on their own TTL regardless.
 */
export async function invalidateCacheTags(tags: readonly string[]): Promise<number> {
  const unique = uniqueTags(tags);
  if (unique.length === 0) {
    return 0;
  }
  const removed = Number(
    await INVALIDATE_TAGS.run(
      redis,
      [...unique.map(tagSetKey), ...unique.map(tagVersionKey)],
      [unique.length, TAG_VERSION_TTL_MS],
    ),
  );
  logger.info({ tags: unique, removed }, "cache tags invalidated");
  return removed;
}

/** Deletes specific cache keys. */
export async function invalidateCacheKeys(keys: readonly string[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }
  return redis.unlink(...keys);
}

/**
 * Deterministic key for structured parameters: object key order does not matter,
 * `undefined` fields are ignored. hashedCacheKey("catalog", q) -> "collab:catalog:<32 hex>".
 */
export function hashedCacheKey(namespace: string, params: unknown): string {
  const digest = createHash("sha256").update(stableStringify(params)).digest("hex").slice(0, 32);
  return redisKey(namespace, digest);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>();
const refreshing = new Set<string>();

function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = work().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function fillOnMiss<T>(key: string, loader: () => Promise<T>, options: CacheOptions): Promise<T> {
  const tags = uniqueTags(options.tags);

  let versions: string[];
  let lock: Awaited<ReturnType<typeof acquireLock>>;
  try {
    [versions, lock] = await withRedisTimeout(
      Promise.all([
        getTagVersions(tags),
        acquireLock(`cache-fill:${key}`, { ttlMs: FILL_LOCK_TTL_MS, retryCount: 0 }),
      ]),
      FILL_SETUP_TIMEOUT_MS,
      "cache-fill-setup",
    );
  } catch (error) {
    // Redis is down: serve straight from the source without caching.
    logger.warn({ err: error, key }, "cache unavailable; loading from source");
    return loader();
  }

  if (!lock) {
    // Another instance is filling this key; wait briefly for its result.
    for (let attempt = 1; attempt <= FILL_WAIT_ATTEMPTS; attempt++) {
      await sleep(25 * attempt);
      const hit = await readCache<T>(key);
      if (hit) {
        return hit.value;
      }
    }
    return loader();
  }

  try {
    const value = await loader();
    await writeCache(key, value, options, versions).catch((error: unknown) =>
      logger.warn({ err: error, key }, "cache write failed"),
    );
    return value;
  } finally {
    await lock.release().catch(() => undefined);
  }
}

function scheduleBackgroundRefresh<T>(key: string, loader: () => Promise<T>, options: CacheOptions): void {
  if (refreshing.has(key)) {
    return;
  }
  refreshing.add(key);
  void (async () => {
    try {
      const lock = await acquireLock(`cache-refresh:${key}`, { ttlMs: REFRESH_LOCK_TTL_MS, retryCount: 0 });
      if (!lock) {
        return; // Another instance is refreshing.
      }
      try {
        const versions = await getTagVersions(uniqueTags(options.tags));
        const value = await loader();
        await writeCache(key, value, options, versions);
      } finally {
        await lock.release().catch(() => undefined);
      }
    } catch (error) {
      logger.warn({ err: error, key }, "background cache refresh failed; stale entry kept");
    } finally {
      refreshing.delete(key);
    }
  })();
}

function uniqueTags(tags: readonly string[] | undefined): string[] {
  if (!tags || tags.length === 0) {
    return [];
  }
  const unique = [...new Set(tags)];
  if (unique.length > MAX_TAGS_PER_ENTRY) {
    throw new Error(`A cache entry may carry at most ${MAX_TAGS_PER_ENTRY} tags`);
  }
  for (const tag of unique) {
    if (tag.length === 0 || tag.length > 200) {
      throw new Error(`Invalid cache tag "${tag}"`);
    }
  }
  return unique;
}

function validateOptions(options: CacheOptions): void {
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds <= 0) {
    throw new Error("ttlSeconds must be a positive integer");
  }
  const swr = options.staleWhileRevalidateSeconds ?? 0;
  if (!Number.isInteger(swr) || swr < 0) {
    throw new Error("staleWhileRevalidateSeconds must be a non-negative integer");
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const name of Object.keys(record).sort()) {
    const field = record[name];
    if (field !== undefined) {
      sorted[name] = normalize(field);
    }
  }
  return sorted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
