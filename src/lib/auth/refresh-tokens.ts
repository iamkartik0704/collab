import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { hmacSha256Hex, randomToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isRedisAvailable, redis, redisKey, withLock } from "@/lib/redis";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "./cookies";

/**
 * Rotating refresh tokens with reuse detection (OAuth 2.0 Security BCP §4.14).
 * - One "family" per device sign-in. Each refresh replaces the token with a new one.
 * - Presenting an already-rotated token means it leaked: the whole family is revoked.
 * - Two tabs refreshing at the same moment is not theft: a rotation younger than the grace
 *   window answers "concurrent" (client retries with the cookie the first call set).
 * Only HMAC-SHA256(pepper, token) is stored.
 */

const CONCURRENT_ROTATION_GRACE_MS = 30_000;

export interface TokenMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedRefreshToken {
  token: string;
  familyId: string;
  expiresAt: Date;
}

export interface SessionUser {
  id: string;
  role: Role;
  email: string | null;
  name: string | null;
  image: string | null;
}

export type RotationResult =
  | { ok: true; user: SessionUser; issued: IssuedRefreshToken }
  | { ok: false; reason: "invalid" | "expired" | "reused" | "concurrent" | "inactive" };

function hashToken(token: string): string {
  return hmacSha256Hex(token);
}

function metaFields(meta: TokenMeta) {
  return {
    ipHash: meta.ip ? hmacSha256Hex(meta.ip) : null,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
  };
}

/** Starts a new family (sign-in on a device). */
export async function issueRefreshToken(userId: string, meta: TokenMeta): Promise<IssuedRefreshToken> {
  const token = randomToken(32);
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  await db.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), familyId, expiresAt, ...metaFields(meta) },
  });
  return { token, familyId, expiresAt };
}

export async function rotateRefreshToken(rawToken: string, meta: TokenMeta): Promise<RotationResult> {
  if (rawToken.length < 32 || rawToken.length > 128) {
    return { ok: false, reason: "invalid" };
  }
  const tokenHash = hashToken(rawToken);

  const rotate = async (): Promise<RotationResult> => {
      const current = await db.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          replacedBy: { select: { createdAt: true } },
          user: { select: { id: true, role: true, email: true, name: true, image: true, isActive: true } },
        },
      });

      if (!current || current.revokedAt) {
        return { ok: false, reason: "invalid" };
      }

      if (current.replacedById) {
        const rotatedAgoMs = current.replacedBy ? Date.now() - current.replacedBy.createdAt.getTime() : Infinity;
        if (rotatedAgoMs < CONCURRENT_ROTATION_GRACE_MS) {
          return { ok: false, reason: "concurrent" };
        }
        await revokeRefreshFamily(current.familyId, "reuse_detected");
        await revokeUserAccess(current.userId);
        logger.warn({ userId: current.userId, familyId: current.familyId }, "refresh token reuse detected; family revoked");
        return { ok: false, reason: "reused" };
      }

      if (current.expiresAt.getTime() <= Date.now()) {
        return { ok: false, reason: "expired" };
      }

      if (!current.user.isActive) {
        await revokeRefreshFamily(current.familyId, "user_inactive");
        return { ok: false, reason: "inactive" };
      }

      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
      const rotated = await db.$transaction(async (tx) => {
        const next = await tx.refreshToken.create({
          data: { userId: current.userId, tokenHash: hashToken(token), familyId: current.familyId, expiresAt, ...metaFields(meta) },
        });
        // Guard: exactly one rotation per token, even without the Redis lock.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: current.id, replacedById: null, revokedAt: null },
          data: { replacedById: next.id },
        });
        if (claimed.count !== 1) {
          await tx.refreshToken.delete({ where: { id: next.id } });
          return false;
        }
        return true;
      });
      if (!rotated) {
        return { ok: false, reason: "concurrent" };
      }

      const { isActive: _isActive, ...user } = current.user;
      return { ok: true, user, issued: { token, familyId: current.familyId, expiresAt } };
  };

  // The lock serialises tabs refreshing simultaneously; without Redis the DB guard still holds.
  if (!isRedisAvailable()) {
    return rotate();
  }
  return withLock(`refresh:${tokenHash}`, rotate, { ttlMs: 5_000, retryCount: 40, retryDelayMs: 50 });
}

/** Family id for a raw refresh token (used by logout), or null. */
export async function findRefreshFamily(rawToken: string): Promise<{ familyId: string; userId: string } | null> {
  if (rawToken.length < 32 || rawToken.length > 128) return null;
  const record = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { familyId: true, userId: true },
  });
  return record;
}

export async function revokeRefreshFamily(familyId: string, reason: string): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 64) },
  });
  return result.count;
}

/** Signs a user out everywhere (ban, role change, password-equivalent reset). */
export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 64) },
  });
  await revokeUserAccess(userId);
}

const revokedBeforeKey = (userId: string) => redisKey("auth", "revoked-before", userId);

/**
 * Invalidates every access token issued to `userId` up to now, without waiting for them to
 * expire. The marker only needs to outlive the longest-lived access token.
 */
export async function revokeUserAccess(userId: string): Promise<void> {
  await redis.set(revokedBeforeKey(userId), String(Date.now()), "PX", (ACCESS_TOKEN_TTL_SECONDS + 60) * 1000);
}

/** True when the access token (identified by its expiry) predates a revocation marker. */
export async function isAccessRevoked(userId: string, accessExpSeconds: number): Promise<boolean> {
  if (!isRedisAvailable()) {
    // Fail open: the token still expires within ACCESS_TOKEN_TTL_SECONDS.
    return false;
  }
  try {
    const marker = await redis.get(revokedBeforeKey(userId));
    if (marker === null) return false;
    const issuedAtMs = (accessExpSeconds - ACCESS_TOKEN_TTL_SECONDS) * 1000;
    return issuedAtMs <= Number(marker);
  } catch (error) {
    logger.warn({ err: error }, "access revocation check failed");
    return false;
  }
}
