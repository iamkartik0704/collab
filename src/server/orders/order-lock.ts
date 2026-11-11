import type { Currency, OrderStatus } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import { isRedisAvailable, withLock } from "@/lib/redis";

/**
 * Two layers protect every order state change (checkout, payment webhooks, expiry worker):
 *  1. a Redis lock per order, so competing workers queue up instead of piling onto row locks;
 *  2. SELECT ... FOR UPDATE on the Order row inside the transaction - the authoritative guard,
 *     which still holds if Redis is unavailable.
 */
export async function withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  if (!isRedisAvailable()) {
    return fn();
  }
  return withLock(`order:${orderId}`, () => fn(), { ttlMs: 30_000, retryCount: 100, retryDelayMs: 100 });
}

export interface LockedOrder {
  id: string;
  orderNumber: string;
  userId: string;
  status: OrderStatus;
  currency: Currency;
  totalMinor: number;
  discountMinor: number;
  couponId: string | null;
}

export async function lockOrder(tx: TransactionClient, orderId: string): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, "orderNumber", "userId", status, currency, "totalMinor", "discountMinor", "couponId"
      FROM "Order" WHERE id = ${orderId}
       FOR UPDATE`;
  return rows[0] ?? null;
}

const STATUS_TIMESTAMP: Partial<Record<OrderStatus, "placedAt" | "confirmedAt" | "packedAt" | "shippedAt" | "outForDeliveryAt" | "deliveredAt" | "cancelledAt">> = {
  PLACED: "placedAt",
  CONFIRMED: "confirmedAt",
  PACKED: "packedAt",
  SHIPPED: "shippedAt",
  OUT_FOR_DELIVERY: "outForDeliveryAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
};

/** Updates the status, its timestamp column and the timeline in one go. */
export async function transitionOrder(
  tx: TransactionClient,
  input: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    note?: string;
    actorId?: string | null;
    cancelReason?: string | null;
  },
): Promise<void> {
  const timestampField = STATUS_TIMESTAMP[input.to];
  await tx.order.update({
    where: { id: input.orderId },
    data: {
      status: input.to,
      ...(timestampField ? { [timestampField]: new Date() } : {}),
      ...(input.cancelReason !== undefined ? { cancelReason: input.cancelReason } : {}),
    },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: input.orderId,
      fromStatus: input.from,
      toStatus: input.to,
      note: input.note?.slice(0, 500) ?? null,
      actorId: input.actorId ?? null,
    },
  });
}
