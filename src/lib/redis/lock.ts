import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { LuaScript, redis, redisKey } from "./client";

/**
 * Single-primary distributed lock (SET NX PX + compare-and-delete release).
 *
 * Every acquisition also returns a monotonically increasing fencing token. Code that writes
 * to PostgreSQL under a lock should persist / compare it, so a holder that lost its lock
 * (GC pause, network partition) cannot overwrite a newer holder's work.
 */

const FENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ACQUIRE = new LuaScript(
  "lock-acquire",
  `
  if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
    local fence = redis.call('INCR', KEYS[2])
    redis.call('PEXPIRE', KEYS[2], ARGV[3])
    return fence
  end
  return 0
  `,
);

const RELEASE = new LuaScript(
  "lock-release",
  `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
  `,
);

const EXTEND = new LuaScript(
  "lock-extend",
  `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
  `,
);

export interface LockOptions {
  /** Lock lease in ms. Default 10 000. */
  ttlMs?: number;
  /** Additional acquisition attempts after the first. Default 10. */
  retryCount?: number;
  /** Base delay between attempts in ms. Default 100. */
  retryDelayMs?: number;
  /** Random extra delay per attempt in ms, to avoid thundering herds. Default 50. */
  retryJitterMs?: number;
}

export interface Lock {
  readonly resource: string;
  readonly key: string;
  readonly token: string;
  readonly fencingToken: number;
  /** Releases the lock. Resolves false if it had already expired or been taken over. */
  release(): Promise<boolean>;
  /** Resets the lease to `ttlMs`. Resolves false if the lock is no longer held. */
  extend(ttlMs?: number): Promise<boolean>;
}

export class LockAcquisitionError extends Error {
  constructor(readonly resource: string) {
    super(`Could not acquire lock "${resource}"`);
    this.name = "LockAcquisitionError";
  }
}

export class LockLostError extends Error {
  constructor(readonly resource: string) {
    super(`Lock "${resource}" was lost before the critical section finished`);
    this.name = "LockLostError";
  }
}

const DEFAULTS = { ttlMs: 10_000, retryCount: 10, retryDelayMs: 100, retryJitterMs: 50 } as const;

function lockKeys(resource: string): { key: string; fenceKey: string } {
  if (resource.length === 0 || resource.length > 512) {
    throw new Error("Lock resource must be 1-512 characters");
  }
  return { key: redisKey("lock", resource), fenceKey: redisKey("lockfence", resource) };
}

/**
 * Tries to acquire `resource`. Resolves null when it is held by someone else after all
 * retries; rejects when Redis itself fails (callers decide whether to degrade).
 */
export async function acquireLock(resource: string, options: LockOptions = {}): Promise<Lock | null> {
  const { ttlMs, retryCount, retryDelayMs, retryJitterMs } = { ...DEFAULTS, ...options };
  if (!Number.isInteger(ttlMs) || ttlMs < 100) {
    throw new Error("Lock ttlMs must be an integer >= 100");
  }
  const { key, fenceKey } = lockKeys(resource);
  const token = randomUUID();

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const fence = Number(await ACQUIRE.run(redis, [key, fenceKey], [token, ttlMs, FENCE_TTL_MS]));
    if (fence > 0) {
      return createLockHandle(resource, key, token, fence, ttlMs);
    }
    if (attempt < retryCount) {
      await sleep(retryDelayMs + Math.floor(Math.random() * (retryJitterMs + 1)));
    }
  }
  return null;
}

function createLockHandle(resource: string, key: string, token: string, fencingToken: number, defaultTtlMs: number): Lock {
  return {
    resource,
    key,
    token,
    fencingToken,
    async release() {
      return Number(await RELEASE.run(redis, [key], [token])) === 1;
    },
    async extend(ttlMs = defaultTtlMs) {
      return Number(await EXTEND.run(redis, [key], [token, ttlMs])) === 1;
    },
  };
}

export interface WithLockContext {
  /** Aborted if the lease could not be renewed; stop work and do not commit. */
  signal: AbortSignal;
  fencingToken: number;
}

/**
 * Runs `fn` while holding `resource`, renewing the lease every ttl/3 until `fn` settles.
 * Throws LockAcquisitionError when the lock cannot be obtained, and LockLostError when the
 * lease was lost while `fn` ran (the result of `fn` is discarded in that case).
 */
export async function withLock<T>(
  resource: string,
  fn: (context: WithLockContext) => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULTS.ttlMs;
  const lock = await acquireLock(resource, options);
  if (!lock) {
    throw new LockAcquisitionError(resource);
  }

  const controller = new AbortController();
  const renewal = setInterval(() => {
    lock.extend(ttlMs).then(
      (stillHeld) => {
        if (!stillHeld) controller.abort(new LockLostError(resource));
      },
      (error: unknown) => {
        logger.error({ err: error, resource }, "lock renewal failed");
        controller.abort(new LockLostError(resource));
      },
    );
  }, Math.max(50, Math.floor(ttlMs / 3)));
  renewal.unref();

  try {
    const result = await fn({ signal: controller.signal, fencingToken: lock.fencingToken });
    if (controller.signal.aborted) {
      throw new LockLostError(resource);
    }
    return result;
  } finally {
    clearInterval(renewal);
    try {
      await lock.release();
    } catch (error) {
      // The lease expires on its own; a failed release only delays the next holder.
      logger.warn({ err: error, resource }, "lock release failed");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
