import type { AdminAlertType, Prisma, StockMovementType } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { db, withTransaction } from "@/lib/db";
import { resolveImageUrl } from "@/lib/images";
import { PostCommitEffects } from "@/lib/post-commit";
import type { Permission } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/rbac";
import type { StockAdjustmentRequest } from "@/schemas/admin";
import { stockAdjustmentSchema } from "@/schemas/admin";
import { adjustStock, StockAdjustmentError, updateLowStockThreshold } from "@/server/inventory/reservation.service";
import { writeAudit } from "./audit";
import type { AdminContext } from "./context";

// ============================================================================ stock table

export type InventoryFilter = "all" | "low" | "out" | "reserved";
export type InventorySort = "urgency" | "sku" | "recent";

export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  title: string;
  imageUrl: string | null;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  version: number;
  warehouse: string;
  status: "in_stock" | "low" | "out";
  updatedAt: string;
}

export interface InventorySummary {
  skus: number;
  lowStock: number;
  outOfStock: number;
  unitsOnHand: number;
  unitsReserved: number;
  /** On-hand units valued at cost price (SKUs without a cost are excluded). */
  stockValueMinor: number;
}

export interface InventoryPage {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageCount: number;
  summary: InventorySummary;
}

export const INVENTORY_PAGE_SIZE = 25;

function stockStatus(available: number, threshold: number): InventoryRow["status"] {
  if (available <= 0) return "out";
  return available <= threshold ? "low" : "in_stock";
}

const LIVE_VARIANT: Prisma.ProductVariantWhereInput = { deletedAt: null, product: { deletedAt: null } };

export async function listInventory(input: { q?: string | undefined; filter: InventoryFilter; sort: InventorySort; page: number }): Promise<InventoryPage> {
  const q = input.q?.trim();
  const threshold = db.inventoryItem.fields.lowStockThreshold;
  const where: Prisma.InventoryItemWhereInput = {
    variant: {
      ...LIVE_VARIANT,
      ...(q ? { OR: [{ sku: { contains: q.toUpperCase() } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    ...(input.filter === "low" ? { quantityAvailable: { lte: threshold, gt: 0 } } : {}),
    ...(input.filter === "out" ? { quantityAvailable: { lte: 0 } } : {}),
    ...(input.filter === "reserved" ? { quantityReserved: { gt: 0 } } : {}),
  };
  const orderBy: Prisma.InventoryItemOrderByWithRelationInput[] =
    input.sort === "sku"
      ? [{ variant: { sku: "asc" } }]
      : input.sort === "recent"
        ? [{ updatedAt: "desc" }]
        : [{ quantityAvailable: "asc" }, { variant: { sku: "asc" } }];

  const total = await db.inventoryItem.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const [items, summary] = await Promise.all([
    db.inventoryItem.findMany({
      where,
      orderBy,
      skip: (page - 1) * INVENTORY_PAGE_SIZE,
      take: INVENTORY_PAGE_SIZE,
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            isActive: true,
            productId: true,
            product: { select: { name: true, images: { where: { isPrimary: true }, take: 1, select: { storageKey: true } } } },
            images: { take: 1, orderBy: { sortOrder: "asc" }, select: { storageKey: true } },
          },
        },
      },
    }),
    getInventorySummary(),
  ]);

  return {
    total,
    page,
    pageCount,
    summary,
    rows: items.map((item) => ({
      variantId: item.variantId,
      productId: item.variant.productId,
      productName: item.variant.product.name,
      sku: item.variant.sku,
      title: item.variant.title,
      imageUrl: resolveImageUrl(item.variant.images[0]?.storageKey ?? item.variant.product.images[0]?.storageKey),
      isActive: item.variant.isActive,
      onHand: item.quantityOnHand,
      reserved: item.quantityReserved,
      available: item.quantityAvailable,
      threshold: item.lowStockThreshold,
      version: item.version,
      warehouse: item.warehouseLocation,
      status: stockStatus(item.quantityAvailable, item.lowStockThreshold),
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

export async function getInventorySummary(): Promise<InventorySummary> {
  const rows = await db.$queryRaw<Array<{ skus: bigint; low: bigint; out: bigint; on_hand: bigint | null; reserved: bigint | null; value: bigint | null }>>`
    SELECT count(*)                                                                  AS skus,
           count(*) FILTER (WHERE i."quantityAvailable" > 0
                              AND i."quantityAvailable" <= i."lowStockThreshold")    AS low,
           count(*) FILTER (WHERE i."quantityAvailable" <= 0)                        AS out,
           sum(i."quantityOnHand")                                                   AS on_hand,
           sum(i."quantityReserved")                                                 AS reserved,
           sum(i."quantityOnHand"::bigint * v."costPriceMinor")                      AS value
      FROM "InventoryItem" i
      JOIN "ProductVariant" v ON v.id = i."variantId" AND v."deletedAt" IS NULL
      JOIN "Product" p ON p.id = v."productId" AND p."deletedAt" IS NULL`;
  const row = rows[0];
  return {
    skus: Number(row?.skus ?? 0),
    lowStock: Number(row?.low ?? 0),
    outOfStock: Number(row?.out ?? 0),
    unitsOnHand: Number(row?.on_hand ?? 0),
    unitsReserved: Number(row?.reserved ?? 0),
    stockValueMinor: Number(row?.value ?? 0),
  };
}

// ============================================================================ mutations

function toApiError(error: unknown): never {
  if (error instanceof StockAdjustmentError) {
    if (error.code === "not_found") throw Errors.notFound("Inventory record");
    if (error.code === "version_conflict") throw Errors.conflict(error.code, error.message);
    throw Errors.unprocessable(error.code, error.message);
  }
  throw error;
}

export async function applyStockAdjustment(ctx: AdminContext, variantId: string, request: StockAdjustmentRequest) {
  const input = stockAdjustmentSchema.parse(request);
  const effects = new PostCommitEffects();
  try {
    const result = await withTransaction(async (tx) => {
      const change = await adjustStock(tx, {
        variantId,
        mode: input.mode,
        quantity: input.quantity,
        reason: input.reason,
        note: input.note,
        actorId: ctx.actor.id,
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
        effects,
      });
      await writeAudit(tx, ctx, {
        action: "STOCK_ADJUSTMENT",
        entityType: "InventoryItem",
        entityId: variantId,
        before: change.before,
        after: change.after,
        reason: [input.reason, input.note].filter(Boolean).join(": "),
      });
      return change.after;
    });
    await effects.flush();
    return result;
  } catch (error) {
    toApiError(error);
  }
}

export async function setLowStockThreshold(ctx: AdminContext, variantId: string, threshold: number) {
  const effects = new PostCommitEffects();
  try {
    const result = await withTransaction(async (tx) => {
      const change = await updateLowStockThreshold(tx, { variantId, threshold, effects });
      if (change.before !== change.after) {
        await writeAudit(tx, ctx, {
          action: "UPDATE",
          entityType: "InventoryItem",
          entityId: variantId,
          before: { lowStockThreshold: change.before },
          after: { lowStockThreshold: change.after },
        });
      }
      return change;
    });
    await effects.flush();
    return result;
  } catch (error) {
    toApiError(error);
  }
}

// ============================================================================ movement log

export interface MovementRow {
  id: string;
  createdAt: string;
  type: StockMovementType;
  reason: string | null;
  note: string | null;
  sku: string;
  productName: string;
  variantId: string;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  availableAfter: number;
  orderNumber: string | null;
  actor: string | null;
}

export interface MovementFilters {
  variantId?: string | undefined;
  type?: StockMovementType | undefined;
  q?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: string | undefined;
  limit?: number;
}

/** Keyset pagination on (createdAt, id) - stable while new movements keep arriving. */
export async function listMovements(filters: MovementFilters): Promise<{ rows: MovementRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 1000);
  let cursorWhere: Prisma.StockMovementLogWhereInput = {};
  if (filters.cursor) {
    const [ts, id] = Buffer.from(filters.cursor, "base64url").toString("utf8").split("|");
    const at = ts ? new Date(ts) : null;
    if (at && !Number.isNaN(at.getTime()) && id) {
      cursorWhere = { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
    }
  }
  const q = filters.q?.trim();
  const rows = await db.stockMovementLog.findMany({
    where: {
      AND: [
        cursorWhere,
        filters.variantId ? { variantId: filters.variantId } : {},
        filters.type ? { type: filters.type } : {},
        filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {},
        q ? { OR: [{ variant: { sku: { contains: q.toUpperCase() } } }, { order: { orderNumber: { contains: q.toUpperCase() } } }] } : {},
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      variant: { select: { sku: true, product: { select: { name: true } } } },
      order: { select: { orderNumber: true } },
      actor: { select: { name: true, email: true } },
    },
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url") : null,
    rows: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      type: row.type,
      reason: row.reason,
      note: row.note,
      sku: row.variant.sku,
      productName: row.variant.product.name,
      variantId: row.variantId,
      onHandDelta: row.onHandDelta,
      reservedDelta: row.reservedDelta,
      onHandAfter: row.onHandAfter,
      reservedAfter: row.reservedAfter,
      availableAfter: row.availableAfter,
      orderNumber: row.order?.orderNumber ?? null,
      actor: row.actor ? (row.actor.name ?? row.actor.email) : null,
    })),
  };
}

// ============================================================================ alerts

export interface AlertRow {
  id: string;
  type: AdminAlertType;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

/** Who may see and acknowledge each kind of alert. */
const ALERT_PERMISSIONS: Record<AdminAlertType, Permission> = {
  LOW_STOCK: "inventory:write",
  OUT_OF_STOCK: "inventory:write",
  SUPPORT_ESCALATION: "support:inbox",
  PAYMENT_ANOMALY: "refunds:issue",
  WEBHOOK_FAILURE: "audit:read",
  NOTIFICATION_DEAD_LETTER: "audit:read",
};

export function visibleAlertTypes(role: AdminContext["actor"]["role"]): AdminAlertType[] {
  return (Object.keys(ALERT_PERMISSIONS) as AdminAlertType[]).filter((type) => hasPermission(role, ALERT_PERMISSIONS[type]));
}

export async function listAlerts(input: { types: AdminAlertType[]; includeAcknowledged?: boolean; limit?: number }): Promise<AlertRow[]> {
  if (input.types.length === 0) return [];
  const alerts = await db.adminAlert.findMany({
    where: { type: { in: input.types }, ...(input.includeAcknowledged ? {} : { acknowledgedAt: null }) },
    orderBy: [{ acknowledgedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: input.limit ?? 50,
    include: { acknowledgedBy: { select: { name: true, email: true } } },
  });
  return alerts.map((alert) => ({
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    entityType: alert.entityType,
    entityId: alert.entityId,
    createdAt: alert.createdAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: alert.acknowledgedBy ? (alert.acknowledgedBy.name ?? alert.acknowledgedBy.email) : null,
  }));
}

export async function acknowledgeAlert(ctx: AdminContext, alertId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const alert = await tx.adminAlert.findUnique({ where: { id: alertId }, select: { id: true, type: true, acknowledgedAt: true, title: true } });
    if (!alert) throw Errors.notFound("Alert");
    if (!hasPermission(ctx.actor.role, ALERT_PERMISSIONS[alert.type])) throw Errors.forbidden();
    if (alert.acknowledgedAt) return;
    const updated = await tx.adminAlert.updateMany({
      where: { id: alertId, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: ctx.actor.id },
    });
    if (updated.count === 1) {
      await writeAudit(tx, ctx, { action: "UPDATE", entityType: "AdminAlert", entityId: alertId, before: { acknowledged: false }, after: { acknowledged: true }, reason: alert.title });
    }
  });
}

