import type { AdminAuditAction, Prisma } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import type { AdminContext } from "./context";

/**
 * Immutable admin audit trail. Entries are written inside the same transaction as the mutation
 * they describe, so a change can never commit without its record (and the table rejects
 * UPDATE/DELETE at the database level).
 */

export interface AuditEntry {
  action: AdminAuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

type JsonObject = Record<string, unknown>;

/** Dates -> ISO strings, undefined dropped: a JSON-safe snapshot. */
export function snapshot(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Top-level field diff: `{ field: { from, to } }` for every field whose JSON value changed. */
export function diffSnapshots(before: unknown, after: unknown): Record<string, { from: unknown; to: unknown }> | null {
  if (!isObject(before) || !isObject(after)) return null;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from, to };
    }
  }
  return changes;
}

export async function writeAudit(tx: TransactionClient, ctx: AdminContext, entry: AuditEntry): Promise<void> {
  const before = snapshot(entry.before);
  const after = snapshot(entry.after);
  const diff = before !== null && after !== null ? diffSnapshots(before, after) : null;
  await tx.adminAuditLog.create({
    data: {
      actorId: ctx.actor.id,
      actorRole: ctx.actor.role,
      action: entry.action,
      entityType: entry.entityType.slice(0, 60),
      entityId: entry.entityId.slice(0, 64),
      before: before ?? undefined,
      after: after ?? undefined,
      diff: diff ? (snapshot(diff) ?? undefined) : undefined,
      reason: entry.reason?.slice(0, 500) ?? null,
      ip: ctx.ip.slice(0, 45),
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId.slice(0, 64),
    },
  });
}
