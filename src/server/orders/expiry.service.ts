import { db, withTransaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PostCommitEffects } from "@/lib/post-commit";
import { releaseCouponRedemption } from "@/server/coupons/coupon.service";
import { releaseReservations } from "@/server/inventory/reservation.service";
import { getPaymentGateway } from "@/server/payments";
import { lockOrder, transitionOrder, withOrderLock } from "./order-lock";

export type CancellationReason = "payment_window_expired" | "payment_cancelled" | "payment_initiation_failed" | "cancelled_by_admin";

export type ExpiryOutcome =
  | { status: "cancelled"; unitsReleased: number }
  | { status: "not_pending" }
  | { status: "not_found" }
  | { status: "not_due"; dueAt: Date };

/**
 * Cancels a PENDING_PAYMENT order and atomically returns its reserved stock and coupon use.
 * Safe to call any number of times and concurrently with a payment webhook: whichever takes the
 * order lock first wins, and the other sees a non-pending order (or a late payment, which
 * re-acquires stock or refunds).
 */
export async function cancelPendingOrder(orderId: string, reason: CancellationReason): Promise<ExpiryOutcome> {
  return withOrderLock(orderId, async () => {
    const effects = new PostCommitEffects();
    const outcome = await withTransaction(async (tx): Promise<ExpiryOutcome> => {
      const order = await lockOrder(tx, orderId);
      if (!order) return { status: "not_found" };
      if (order.status !== "PENDING_PAYMENT") return { status: "not_pending" };

      if (reason === "payment_window_expired") {
        const earliest = await tx.stockReservation.findFirst({
          where: { orderId, status: "ACTIVE" },
          orderBy: { expiresAt: "asc" },
          select: { expiresAt: true },
        });
        if (earliest && earliest.expiresAt.getTime() > Date.now()) {
          return { status: "not_due", dueAt: earliest.expiresAt };
        }
      }

      const unitsReleased = await releaseReservations(tx, {
        orderId,
        status: reason === "payment_window_expired" ? "EXPIRED" : "RELEASED",
        reason,
        effects,
      });
      await releaseCouponRedemption(tx, orderId);
      await transitionOrder(tx, { orderId, from: order.status, to: "CANCELLED", note: reason, cancelReason: reason });

      const payments = await tx.payment.findMany({
        where: { orderId, status: { in: ["CREATED", "PENDING", "AUTHORIZED", "FAILED"] } },
        select: { id: true, provider: true, providerOrderId: true },
      });
      await tx.payment.updateMany({
        where: { id: { in: payments.map((payment) => payment.id) } },
        data: { status: "CANCELLED" },
      });
      for (const payment of payments) {
        if (payment.providerOrderId) {
          const providerOrderId = payment.providerOrderId;
          effects.add(`cancel-${payment.provider}-${providerOrderId}`, () =>
            getPaymentGateway(payment.provider).cancelSession(providerOrderId),
          );
        }
      }
      return { status: "cancelled", unitsReleased };
    });
    await effects.flush();
    if (outcome.status === "cancelled") {
      logger.info({ orderId, reason, unitsReleased: outcome.unitsReleased }, "pending order cancelled; stock released");
    }
    return outcome;
  });
}

/**
 * Backstop for lost delayed jobs: cancels pending orders whose reservations expired more than
 * `graceMs` ago. Run every minute by the inventory worker.
 */
export async function sweepExpiredReservations(limit = 100, graceMs = 30_000): Promise<number> {
  const stale = await db.stockReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date(Date.now() - graceMs) }, order: { status: "PENDING_PAYMENT" } },
    distinct: ["orderId"],
    select: { orderId: true },
    take: limit,
  });
  let cancelled = 0;
  for (const { orderId } of stale) {
    try {
      const outcome = await cancelPendingOrder(orderId, "payment_window_expired");
      if (outcome.status === "cancelled") cancelled++;
    } catch (error) {
      logger.error({ err: error, orderId }, "sweeper failed to cancel expired order");
    }
  }
  return cancelled;
}
