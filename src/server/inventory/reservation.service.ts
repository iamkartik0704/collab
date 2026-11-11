import type { Prisma, ReservationStatus, StockAdjustmentReason, StockMovementType } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import type { PostCommitEffects } from "@/lib/post-commit";
import { publishInventoryEvent } from "@/lib/realtime/inventory-events";
import { CacheTags, invalidateCacheTags } from "@/lib/redis";
import { notifyLowStock } from "@/server/notifications/notify";

/**
 * Zero-oversell stock control.
 *
 * Every function here runs inside the caller's transaction and locks the affected
 * InventoryItem rows with SELECT ... FOR UPDATE, always in variantId order so concurrent
 * checkouts cannot deadlock. A plain FOR UPDATE (not SKIP LOCKED) is deliberate: SKIP LOCKED
 * would report a variant as unavailable merely because another checkout holds its row for a few
 * milliseconds. Contention is bounded by `lock_timeout`; the DB CHECK constraints
 * (quantities >= 0, available = onHand - reserved) are the last line of defence.
 *
 * Lifecycle: reserve (available -> reserved) -> consume on payment (reserved and onHand drop)
 *            or release on expiry/failure (reserved -> available). Every change writes a
 *            StockMovementLog row with the resulting quantities.
 */

export const RESERVATION_TTL_MS = 15 * 60 * 1000;
const LOCK_TIMEOUT = "5s";

export interface StockShortage {
  variantId: string;
  sku: string | null;
  requested: number;
  available: number;
}

export class InsufficientStockError extends Error {
  constructor(readonly shortages: StockShortage[]) {
    super(`Insufficient stock for ${shortages.length} item(s)`);
    this.name = "InsufficientStockError";
  }
}

interface LockedInventoryRow {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  lowStockThreshold: number;
  lowStockAlertedAt: Date | null;
  version: number;
}

interface StockLine {
  variantId: string;
  quantity: number;
}

function aggregate(lines: readonly StockLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(`Invalid quantity ${line.quantity} for variant ${line.variantId}`);
    }
    totals.set(line.variantId, (totals.get(line.variantId) ?? 0) + line.quantity);
  }
  return totals;
}

/** Locks inventory rows for `variantIds` in a deterministic order. */
async function lockInventory(tx: TransactionClient, variantIds: readonly string[]): Promise<Map<string, LockedInventoryRow>> {
  const sorted = [...new Set(variantIds)].sort();
  if (sorted.length === 0) return new Map();
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  const rows = await tx.$queryRaw<LockedInventoryRow[]>`
    SELECT i.id, i."variantId", v."productId", p.name AS "productName", v.sku,
           i."quantityOnHand", i."quantityReserved", i."quantityAvailable",
           i."lowStockThreshold", i."lowStockAlertedAt", i.version
      FROM "InventoryItem" i
      JOIN "ProductVariant" v ON v.id = i."variantId"
      JOIN "Product" p ON p.id = v."productId"
     WHERE i."variantId" IN (${PrismaNamespace.join(sorted)})
     ORDER BY i."variantId"
       FOR UPDATE OF i`;
  return new Map(rows.map((row) => [row.variantId, row]));
}

interface InventoryChange {
  onHandDelta: number;
  reservedDelta: number;
}

/**
 * Applies a delta to a locked row, writes the movement log and handles low-stock / back-in-stock
 * side effects. Returns the updated row snapshot.
 */
async function applyChange(
  tx: TransactionClient,
  row: LockedInventoryRow,
  change: InventoryChange,
  log: Omit<Prisma.StockMovementLogUncheckedCreateInput, "variantId" | "inventoryItemId" | "onHandDelta" | "reservedDelta" | "onHandAfter" | "reservedAfter" | "availableAfter">,
  effects: PostCommitEffects,
): Promise<LockedInventoryRow> {
  const onHand = row.quantityOnHand + change.onHandDelta;
  const reserved = row.quantityReserved + change.reservedDelta;
  const available = onHand - reserved;
  if (onHand < 0 || reserved < 0 || available < 0) {
    throw new Error(`Inventory invariant violated for variant ${row.variantId}`);
  }

  const crossedIntoLowStock = available <= row.lowStockThreshold && row.lowStockAlertedAt === null;
  const recovered = available > row.lowStockThreshold && row.lowStockAlertedAt !== null;
  const lowStockAlertedAt = crossedIntoLowStock ? new Date() : recovered ? null : row.lowStockAlertedAt;

  await tx.inventoryItem.update({
    where: { id: row.id },
    data: {
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: available,
      lowStockAlertedAt,
      version: { increment: 1 },
    },
  });
  await tx.stockMovementLog.create({
    data: {
      ...log,
      variantId: row.variantId,
      inventoryItemId: row.id,
      onHandDelta: change.onHandDelta,
      reservedDelta: change.reservedDelta,
      onHandAfter: onHand,
      reservedAfter: reserved,
      availableAfter: available,
    },
  });

  if (crossedIntoLowStock) {
    await raiseLowStockAlert(tx, row, available, effects);
  }

  effects.add(`inventory-event:${row.variantId}:${row.version + 1}`, () =>
    publishInventoryEvent({
      variantId: row.variantId,
      sku: row.sku,
      onHand,
      reserved,
      available,
      threshold: row.lowStockThreshold,
      version: row.version + 1,
      at: new Date().toISOString(),
    }),
  );

  // Storefront listings and product cards show stock state: refresh them when a variant sells
  // out or comes back (rare, so clearing listing/home caches here is cheap).
  if ((row.quantityAvailable > 0) !== (available > 0)) {
    effects.add(`invalidate-product:${row.productId}`, () =>
      invalidateCacheTags([CacheTags.product(row.productId), CacheTags.catalog(), CacheTags.home()]),
    );
  }

  return { ...row, quantityOnHand: onHand, quantityReserved: reserved, quantityAvailable: available, lowStockAlertedAt, version: row.version + 1 };
}

/** Admin feed entry (deduplicated per variant per day) + email/WhatsApp fan-out after commit. */
async function raiseLowStockAlert(
  tx: TransactionClient,
  row: Pick<LockedInventoryRow, "variantId" | "sku" | "productName" | "lowStockThreshold">,
  available: number,
  effects: PostCommitEffects,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await tx.adminAlert.createMany({
    data: [
      {
        type: available === 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
        severity: available === 0 ? "CRITICAL" : "WARNING",
        title: available === 0 ? `Out of stock: ${row.sku}` : `Low stock: ${row.sku}`,
        message: `${row.productName} (${row.sku}) has ${available} unit(s) available (threshold ${row.lowStockThreshold}).`,
        entityType: "ProductVariant",
        entityId: row.variantId,
        dedupeKey: `${available === 0 ? "out-of-stock" : "low-stock"}:${row.variantId}:${day}`,
      },
    ],
    skipDuplicates: true,
  });
  effects.add(`low-stock-alert:${row.sku}`, () =>
    notifyLowStock({ variantId: row.variantId, sku: row.sku, productName: row.productName, available, threshold: row.lowStockThreshold }),
  );
}


/**
 * Moves units from available to reserved for every line of a pending order (all-or-nothing)
 * and records ACTIVE StockReservation rows expiring at `expiresAt`.
 * Throws InsufficientStockError listing every short line.
 */
export async function reserveStock(
  tx: TransactionClient,
  input: { orderId: string; lines: readonly StockLine[]; expiresAt: Date; effects: PostCommitEffects },
): Promise<void> {
  const totals = aggregate(input.lines);
  const rows = await lockInventory(tx, [...totals.keys()]);

  const shortages: StockShortage[] = [];
  for (const [variantId, quantity] of totals) {
    const row = rows.get(variantId);
    const available = row?.quantityAvailable ?? 0;
    if (available < quantity) {
      shortages.push({ variantId, sku: row?.sku ?? null, requested: quantity, available });
    }
  }
  if (shortages.length > 0) {
    throw new InsufficientStockError(shortages);
  }

  for (const [variantId, quantity] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = rows.get(variantId)!;
    const reservation = await tx.stockReservation.create({
      data: { orderId: input.orderId, variantId, inventoryItemId: row.id, quantity, expiresAt: input.expiresAt },
      select: { id: true },
    });
    await applyChange(
      tx,
      row,
      { onHandDelta: 0, reservedDelta: quantity },
      { type: "RESERVATION", orderId: input.orderId, reservationId: reservation.id },
      input.effects,
    );
  }
}

interface LockedReservation {
  id: string;
  variantId: string;
  quantity: number;
  status: ReservationStatus;
}

async function lockReservations(tx: TransactionClient, orderId: string): Promise<LockedReservation[]> {
  return tx.$queryRaw<LockedReservation[]>`
    SELECT id, "variantId", quantity, status
      FROM "StockReservation"
     WHERE "orderId" = ${orderId}
     ORDER BY "variantId"
       FOR UPDATE`;
}

/**
 * Returns an order's ACTIVE reservations to available stock (payment expired / failed /
 * cancelled). Idempotent: already-released reservations are skipped. Returns units released.
 */
export async function releaseReservations(
  tx: TransactionClient,
  input: { orderId: string; status: "EXPIRED" | "RELEASED"; reason: string; effects: PostCommitEffects },
): Promise<number> {
  const active = (await lockReservations(tx, input.orderId)).filter((reservation) => reservation.status === "ACTIVE");
  if (active.length === 0) return 0;

  const rows = await lockInventory(tx, active.map((reservation) => reservation.variantId));
  let released = 0;
  for (const reservation of active) {
    const row = rows.get(reservation.variantId);
    if (!row) {
      throw new Error(`Inventory row missing for reserved variant ${reservation.variantId}`);
    }
    rows.set(
      reservation.variantId,
      await applyChange(
        tx,
        row,
        { onHandDelta: 0, reservedDelta: -reservation.quantity },
        { type: "RESERVATION_RELEASE", orderId: input.orderId, reservationId: reservation.id, note: input.reason.slice(0, 500) },
        input.effects,
      ),
    );
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: input.status, releasedAt: new Date(), releaseReason: input.reason.slice(0, 64) },
    });
    released += reservation.quantity;
  }
  return released;
}

export type ConsumeResult = { ok: true; reacquired: boolean } | { ok: false; shortages: StockShortage[] };

/**
 * Converts an order's reservations into a sale after verified payment:
 * - ACTIVE reservations: reserved and on-hand both drop (available is unchanged).
 * - Reservations that already EXPIRED/RELEASED (payment arrived late): the units are taken
 *   straight from available stock if it is still there.
 * All-or-nothing: if a late payment cannot be covered, nothing changes and the shortages are
 * returned so the caller can refund.
 */
export async function consumeReservations(
  tx: TransactionClient,
  input: { orderId: string; effects: PostCommitEffects },
): Promise<ConsumeResult> {
  const reservations = await lockReservations(tx, input.orderId);
  const pending = reservations.filter((reservation) => reservation.status !== "CONSUMED");
  if (pending.length === 0) return { ok: true, reacquired: false };

  const rows = await lockInventory(tx, pending.map((reservation) => reservation.variantId));

  const lapsed = pending.filter((reservation) => reservation.status !== "ACTIVE");
  const shortages: StockShortage[] = [];
  for (const reservation of lapsed) {
    const row = rows.get(reservation.variantId);
    const available = row?.quantityAvailable ?? 0;
    if (available < reservation.quantity) {
      shortages.push({ variantId: reservation.variantId, sku: row?.sku ?? null, requested: reservation.quantity, available });
    }
  }
  if (shortages.length > 0) {
    return { ok: false, shortages };
  }

  for (const reservation of pending) {
    const row = rows.get(reservation.variantId);
    if (!row) {
      throw new Error(`Inventory row missing for variant ${reservation.variantId}`);
    }
    const change =
      reservation.status === "ACTIVE"
        ? { onHandDelta: -reservation.quantity, reservedDelta: -reservation.quantity }
        : { onHandDelta: -reservation.quantity, reservedDelta: 0 };
    rows.set(
      reservation.variantId,
      await applyChange(tx, row, change, { type: "SALE", orderId: input.orderId, reservationId: reservation.id }, input.effects),
    );
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: "CONSUMED", consumedAt: new Date() },
    });
  }
  return { ok: true, reacquired: lapsed.length > 0 };
}


// ============================================================================ admin operations

export class StockAdjustmentError extends Error {
  constructor(
    readonly code: "below_reserved" | "version_conflict" | "not_found" | "no_change" | "wrong_direction",
    message: string,
  ) {
    super(message);
    this.name = "StockAdjustmentError";
  }
}

/** Movement type recorded for each adjustment reason, and the direction it allows. */
export const ADJUSTMENT_REASONS = {
  PURCHASE_ORDER_RECEIVED: { type: "RESTOCK", direction: "in" },
  CUSTOMER_RETURN_RESTOCK: { type: "CUSTOMER_RETURN", direction: "in" },
  DAMAGED: { type: "DAMAGE", direction: "out" },
  LOST_OR_STOLEN: { type: "DAMAGE", direction: "out" },
  RETURN_TO_VENDOR: { type: "MANUAL_ADJUSTMENT", direction: "out" },
  CYCLE_COUNT_CORRECTION: { type: "MANUAL_ADJUSTMENT", direction: "any" },
  SYSTEM_CORRECTION: { type: "MANUAL_ADJUSTMENT", direction: "any" },
} as const satisfies Record<StockAdjustmentReason, { type: StockMovementType; direction: "in" | "out" | "any" }>;

export interface StockAdjustmentInput {
  variantId: string;
  /** "delta": add/remove units; "set": the physical count becomes `quantity` on hand. */
  mode: "delta" | "set";
  quantity: number;
  reason: StockAdjustmentReason;
  note?: string | null;
  actorId: string;
  /** The InventoryItem version the admin saw; a concurrent change raises a conflict. */
  expectedVersion?: number;
  effects: PostCommitEffects;
}

export interface InventorySnapshot {
  variantId: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  version: number;
}

function toSnapshot(row: LockedInventoryRow): InventorySnapshot {
  return {
    variantId: row.variantId,
    sku: row.sku,
    onHand: row.quantityOnHand,
    reserved: row.quantityReserved,
    available: row.quantityAvailable,
    threshold: row.lowStockThreshold,
    version: row.version,
  };
}

/**
 * Manual on-hand adjustment under the same row lock as checkout, so it can never race a
 * reservation into oversell: on-hand may not drop below the units currently reserved.
 */
export async function adjustStock(tx: TransactionClient, input: StockAdjustmentInput): Promise<{ before: InventorySnapshot; after: InventorySnapshot }> {
  const row = (await lockInventory(tx, [input.variantId])).get(input.variantId);
  if (!row) throw new StockAdjustmentError("not_found", "This SKU has no inventory record.");
  if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
    throw new StockAdjustmentError("version_conflict", "Stock changed since you loaded it. Review the latest numbers and try again.");
  }
  const delta = input.mode === "set" ? input.quantity - row.quantityOnHand : input.quantity;
  if (!Number.isInteger(delta) || delta === 0) {
    throw new StockAdjustmentError("no_change", "The adjustment does not change the stock level.");
  }
  const rule = ADJUSTMENT_REASONS[input.reason];
  if ((rule.direction === "in" && delta < 0) || (rule.direction === "out" && delta > 0)) {
    throw new StockAdjustmentError("wrong_direction", `This reason can only ${rule.direction === "in" ? "add" : "remove"} stock.`);
  }
  if (row.quantityOnHand + delta < row.quantityReserved) {
    throw new StockAdjustmentError(
      "below_reserved",
      `${row.quantityReserved} unit(s) are reserved by pending checkouts; on hand cannot go below that.`,
    );
  }
  const after = await applyChange(
    tx,
    row,
    { onHandDelta: delta, reservedDelta: 0 },
    { type: rule.type, reason: input.reason, note: input.note?.slice(0, 500) ?? null, actorId: input.actorId },
    input.effects,
  );
  return { before: toSnapshot(row), after: toSnapshot(after) };
}

/** Changes the low-stock threshold and re-evaluates the alert state against it. */
export async function updateLowStockThreshold(
  tx: TransactionClient,
  input: { variantId: string; threshold: number; effects: PostCommitEffects },
): Promise<{ before: number; after: number }> {
  const row = (await lockInventory(tx, [input.variantId])).get(input.variantId);
  if (!row) throw new StockAdjustmentError("not_found", "This SKU has no inventory record.");
  const isLow = row.quantityAvailable <= input.threshold;
  const lowStockAlertedAt = isLow ? (row.lowStockAlertedAt ?? new Date()) : null;
  await tx.inventoryItem.update({
    where: { id: row.id },
    data: { lowStockThreshold: input.threshold, lowStockAlertedAt, version: { increment: 1 } },
  });
  if (isLow && row.lowStockAlertedAt === null) {
    await raiseLowStockAlert(tx, { ...row, lowStockThreshold: input.threshold }, row.quantityAvailable, input.effects);
  }
  input.effects.add(`inventory-event:${row.variantId}:threshold`, () =>
    publishInventoryEvent({
      variantId: row.variantId,
      sku: row.sku,
      onHand: row.quantityOnHand,
      reserved: row.quantityReserved,
      available: row.quantityAvailable,
      threshold: input.threshold,
      version: row.version + 1,
      at: new Date().toISOString(),
    }),
  );
  return { before: row.lowStockThreshold, after: input.threshold };
}

/**
 * Puts sold units back on the shelf: a paid order cancelled before dispatch
 * (ORDER_CANCELLATION) or a sellable customer return (CUSTOMER_RETURN).
 */
export async function restockUnits(
  tx: TransactionClient,
  input: {
    orderId: string;
    lines: readonly StockLine[];
    type: "ORDER_CANCELLATION" | "CUSTOMER_RETURN";
    note: string;
    actorId: string | null;
    effects: PostCommitEffects;
  },
): Promise<number> {
  const totals = aggregate(input.lines);
  const rows = await lockInventory(tx, [...totals.keys()]);
  let units = 0;
  for (const [variantId, quantity] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = rows.get(variantId);
    if (!row) continue; // SKU without an inventory record: nothing to restock
    rows.set(
      variantId,
      await applyChange(
        tx,
        row,
        { onHandDelta: quantity, reservedDelta: 0 },
        {
          type: input.type,
          reason: input.type === "CUSTOMER_RETURN" ? "CUSTOMER_RETURN_RESTOCK" : null,
          note: input.note.slice(0, 500),
          orderId: input.orderId,
          actorId: input.actorId,
        },
        input.effects,
      ),
    );
    units += quantity;
  }
  return units;
}
