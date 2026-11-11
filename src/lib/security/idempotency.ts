import { randomUUID } from "node:crypto";
import { Errors } from "@/lib/api/errors";
import { LuaScript, redis, redisKey } from "@/lib/redis";

/**
 * Idempotency-Key support (Stripe semantics):
 * - first request with a key runs and its 2xx/4xx response is stored for 24 h;
 * - a retry with the same key and same body replays the stored response;
 * - the same key with a different body is rejected (422);
 * - a retry while the first is still running gets 409;
 * - 5xx outcomes are not stored, so the client may retry with the same key.
 * Keys are scoped per user: collab:idempotency:{scope}:{key}.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
/** A crashed request frees its key after this long. */
const PROCESSING_TTL_MS = 2 * 60 * 1000;

interface ProcessingRecord {
  state: "processing";
  fingerprint: string;
  owner: string;
}

interface CompletedRecord {
  state: "completed";
  fingerprint: string;
  status: number;
  body: unknown;
}

type StoredRecord = ProcessingRecord | CompletedRecord;

export type IdempotencyStart =
  | { kind: "new"; owner: string }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_progress" }
  | { kind: "mismatch" };

const COMPLETE = new LuaScript(
  "idempotency-complete",
  `
  local current = redis.call('GET', KEYS[1])
  if not current then return 0 end
  local record = cjson.decode(current)
  if record.state ~= 'processing' or record.owner ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
  `,
);

const ABANDON = new LuaScript(
  "idempotency-abandon",
  `
  local current = redis.call('GET', KEYS[1])
  if not current then return 0 end
  local record = cjson.decode(current)
  if record.state == 'processing' and record.owner == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
  `,
);

export function parseIdempotencyKey(headers: Headers): string {
  const key = headers.get("idempotency-key")?.trim();
  if (!key) {
    throw Errors.badRequest("idempotency_key_required", "An Idempotency-Key header is required.");
  }
  if (!KEY_PATTERN.test(key)) {
    throw Errors.badRequest(
      "invalid_idempotency_key",
      "Idempotency-Key must be 16-128 characters of letters, digits, '-' or '_'.",
    );
  }
  return key;
}

function storageKey(scope: string, key: string): string {
  return redisKey("idempotency", scope, key);
}

/** Claims `key` for this request, or reports what happened to an earlier request with it. */
export async function beginIdempotentRequest(scope: string, key: string, fingerprint: string): Promise<IdempotencyStart> {
  const owner = randomUUID();
  const record: ProcessingRecord = { state: "processing", fingerprint, owner };
  const claimed = await redis.set(storageKey(scope, key), JSON.stringify(record), "PX", PROCESSING_TTL_MS, "NX");
  if (claimed === "OK") {
    return { kind: "new", owner };
  }

  const raw = await redis.get(storageKey(scope, key));
  if (raw === null) {
    // Expired between SET and GET - claim again once.
    const retry = await redis.set(storageKey(scope, key), JSON.stringify(record), "PX", PROCESSING_TTL_MS, "NX");
    return retry === "OK" ? { kind: "new", owner } : { kind: "in_progress" };
  }
  const existing = JSON.parse(raw) as StoredRecord;
  if (existing.fingerprint !== fingerprint) {
    return { kind: "mismatch" };
  }
  if (existing.state === "processing") {
    return { kind: "in_progress" };
  }
  return { kind: "replay", status: existing.status, body: existing.body };
}

/** Stores the final response so retries replay it. No-op if the claim was lost. */
export async function completeIdempotentRequest(
  scope: string,
  key: string,
  owner: string,
  fingerprint: string,
  status: number,
  body: unknown,
): Promise<void> {
  const record: CompletedRecord = { state: "completed", fingerprint, status, body };
  await COMPLETE.run(redis, [storageKey(scope, key)], [owner, JSON.stringify(record), COMPLETED_TTL_MS]);
}

/** Releases the claim (after a 5xx) so the client can retry with the same key. */
export async function abandonIdempotentRequest(scope: string, key: string, owner: string): Promise<void> {
  await ABANDON.run(redis, [storageKey(scope, key)], [owner]);
}
