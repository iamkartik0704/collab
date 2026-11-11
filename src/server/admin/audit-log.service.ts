import type { AdminAuditAction, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

export interface AuditLogRow {
  id: string;
  createdAt: string;
  actor: { id: string; name: string | null; email: string | null };
  actorRole: Role;
  action: AdminAuditAction;
  entityType: string;
  entityId: string;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  diff: Prisma.JsonValue;
}

export interface AuditLogFilters {
  action?: AdminAuditAction | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: string | undefined;
  limit?: number;
}

function decodeCursor(cursor: string | undefined): Prisma.AdminAuditLogWhereInput {
  if (!cursor) return {};
  const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const at = ts ? new Date(ts) : null;
  if (!at || Number.isNaN(at.getTime()) || !id) return {};
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
}

/** Newest first, keyset-paginated on (createdAt, id). */
export async function listAuditLog(filters: AuditLogFilters): Promise<{ rows: AuditLogRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 5000);
  const rows = await db.adminAuditLog.findMany({
    where: {
      AND: [
        decodeCursor(filters.cursor),
        filters.action ? { action: filters.action } : {},
        filters.entityType ? { entityType: filters.entityType } : {},
        filters.entityId ? { entityId: filters.entityId } : {},
        filters.actorId ? { actorId: filters.actorId } : {},
        filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {},
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url") : null,
    rows: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      reason: row.reason,
      ip: row.ip,
      userAgent: row.userAgent,
      requestId: row.requestId,
      before: row.before,
      after: row.after,
      diff: row.diff,
    })),
  };
}

export async function getAuditFilterOptions() {
  const [entityTypes, actors] = await Promise.all([
    db.adminAuditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);
  return { entityTypes: entityTypes.map((row) => row.entityType), actors };
}

/** RFC 4180 CSV cell; neutralises spreadsheet formula injection (=, +, -, @ prefixes). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
