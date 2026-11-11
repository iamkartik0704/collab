import type { Currency, PaymentMethodType, PaymentProvider } from "@prisma/client";
import { db, withTransaction, type TransactionClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PostCommitEffects } from "@/lib/post-commit";
import { cancelReservationExpiry, enqueueCreditNote, enqueueImmediateRelease, enqueueRefundExecution } from "@/queues";
import { clearPurchasedItems } from "@/server/cart/cart.service";
import { restoreCouponRedemption } from "@/server/coupons/coupon.service";
import { consumeReservations } from "@/server/inventory/reservation.service";
import { queueNotification } from "@/server/notifications/notify";
import { lockOrder, transitionOrder, withOrderLock } from "@/server/orders/order-lock";
import { getPaymentGateway } from "./index";

/**
 * State transitions driven by VERIFIED provider webhooks (never by the browser).
 * Every handler is idempotent: providers deliver at-least-once and in any order.
 */

export interface PaymentSucceededEvent {
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId: string | null;
  /** Order id from provider metadata/notes - fallback lookup if providerOrderId was never stored. */
  orderIdHint: string | null;
  amountMinor: number;
  currency: string;
  method: PaymentMethodType | null;
}

export type PaymentSucceededOutcome =
  | "fulfilled"
  | "already_processed"
  | "refunded_out_of_stock"
  | "amount_mismatch"
  | "unknown_payment";

const SETTLED = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

async function findPayment(provider: PaymentProvider, providerOrderId: string, orderIdHint: string | null) {
  const byProviderId = await db.payment.findUnique({
    where: { provider_providerOrderId: { provider, providerOrderId } },
    select: { id: true, orderId: true },
  });
  if (byProviderId) return byProviderId;
  if (!orderIdHint) return null;
  return db.payment.findFirst({
    where: { orderId: orderIdHint, provider },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderId: true },
  });
}

async function raisePaymentAlert(tx: TransactionClient, input: { title: string; message: string; entityId: string; dedupeKey: string; critical?: boolean }) {
  await tx.adminAlert.createMany({
    data: [
      {
        type: "PAYMENT_ANOMALY",
        severity: input.critical ? "CRITICAL" : "WARNING",
        title: input.title.slice(0, 160),
        message: input.message.slice(0, 1000),
        entityType: "Payment",
        entityId: input.entityId,
        dedupeKey: input.dedupeKey.slice(0, 160),
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * payment_intent.succeeded / payment.captured / order.paid.
 * Normal path: consume reservations, PENDING_PAYMENT -> PLACED, clear purchased cart lines,
 * queue confirmations. Late path (reservation already expired): re-acquire stock if it is still
 * available, otherwise cancel and refund automatically.
 */
export async function handlePaymentSucceeded(event: PaymentSucceededEvent): Promise<PaymentSucceededOutcome> {
  const located = await findPayment(event.provider, event.providerOrderId, event.orderIdHint);
  if (!located) {
    logger.error({ event }, "payment succeeded for an unknown payment");
    await raisePaymentAlert(db, {
      title: "Payment received for unknown order",
      message: `${event.provider} payment ${event.providerPaymentId ?? event.providerOrderId} (${event.amountMinor} ${event.currency}) has no matching Collab order. Refund manually.`,
      entityId: event.providerOrderId.slice(0, 64),
      dedupeKey: `unknown-payment:${event.providerOrderId}`,
      critical: true,
    });
    return "unknown_payment";
  }

  return withOrderLock(located.orderId, async () => {
    const effects = new PostCommitEffects();
    const outcome = await withTransaction(async (tx): Promise<PaymentSucceededOutcome> => {
      const order = await lockOrder(tx, located.orderId);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: located.id } });
      if (!order) throw new Error(`Order ${located.orderId} vanished`);
      if ((SETTLED as readonly string[]).includes(payment.status)) {
        return "already_processed";
      }

      if (event.amountMinor !== payment.amountMinor || event.currency.toUpperCase() !== payment.currency) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { failureCode: "amount_mismatch", failureMessage: `Provider reported ${event.amountMinor} ${event.currency}` },
        });
        await raisePaymentAlert(tx, {
          title: `Amount mismatch on ${order.orderNumber}`,
          message: `Expected ${payment.amountMinor} ${payment.currency}, provider reported ${event.amountMinor} ${event.currency}. Order not fulfilled.`,
          entityId: payment.id,
          dedupeKey: `amount-mismatch:${payment.id}`,
          critical: true,
        });
        return "amount_mismatch";
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          providerOrderId: payment.providerOrderId ?? event.providerOrderId,
          providerPaymentId: event.providerPaymentId,
          method: event.method ?? payment.method,
          capturedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });

      if (order.status !== "PENDING_PAYMENT" && order.status !== "CANCELLED" && order.status !== "PAYMENT_FAILED") {
        // Order already progressed (e.g. a duplicate capture event): nothing more to do.
        return "already_processed";
      }

      const consumed = await consumeReservations(tx, { orderId: order.id, effects });
      if (!consumed.ok) {
        if (order.status !== "CANCELLED") {
          await transitionOrder(tx, {
            orderId: order.id,
            from: order.status,
            to: "CANCELLED",
            note: "paid after reservation expired; stock no longer available",
            cancelReason: "out_of_stock_after_payment",
          });
        } else {
          await tx.order.update({ where: { id: order.id }, data: { cancelReason: "out_of_stock_after_payment" } });
        }
        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            provider: payment.provider,
            amountMinor: payment.amountMinor,
            reason: "Automatic refund: item sold out after the payment window expired",
            idempotencyKey: `auto-oos-${payment.id}`,
          },
          select: { id: true },
        });
        await raisePaymentAlert(tx, {
          title: `Auto-refund for ${order.orderNumber}`,
          message: `Payment arrived after the reservation expired and stock was gone (${consumed.shortages.map((s) => s.sku ?? s.variantId).join(", ")}). Full refund issued.`,
          entityId: payment.id,
          dedupeKey: `auto-refund:${payment.id}`,
        });
        effects.add(`auto-refund-${refund.id}`, () => enqueueRefundExecution(refund.id));
        return "refunded_out_of_stock";
      }

      if (order.status === "CANCELLED" && order.couponId) {
        await restoreCouponRedemption(tx, {
          couponId: order.couponId,
          userId: order.userId,
          orderId: order.id,
          discountMinor: order.discountMinor,
        });
      }

      await transitionOrder(tx, {
        orderId: order.id,
        from: order.status,
        to: "PLACED",
        note: consumed.reacquired ? "payment received after reservation expiry; stock re-acquired" : "payment confirmed",
        cancelReason: null,
      });
      if (order.status === "CANCELLED") {
        await tx.order.update({ where: { id: order.id }, data: { cancelledAt: null } });
      }

      const items = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { productId: true, variantId: true, quantity: true } });
      const unitsByProduct = new Map<string, number>();
      for (const item of items) {
        unitsByProduct.set(item.productId, (unitsByProduct.get(item.productId) ?? 0) + item.quantity);
      }
      for (const [productId, units] of unitsByProduct) {
        await tx.product.update({ where: { id: productId }, data: { salesCount: { increment: units } } });
      }
      await clearPurchasedItems(tx, order.userId, items.map((item) => item.variantId));

      const customer = await tx.user.findUniqueOrThrow({
        where: { id: order.userId },
        select: { email: true, phone: true, notificationPreference: { select: { whatsappOptIn: true, emailOrderUpdates: true } } },
      });
      const templateData = { orderNumber: order.orderNumber, totalMinor: order.totalMinor, currency: order.currency };
      if (customer.email && (customer.notificationPreference?.emailOrderUpdates ?? true)) {
        const email = customer.email;
        effects.add("order-confirmation-email", () =>
          queueNotification({ type: "ORDER_CONFIRMATION", channel: "EMAIL", recipient: email, userId: order.userId, orderId: order.id, templateData }),
        );
      }
      if (customer.phone && customer.notificationPreference?.whatsappOptIn) {
        const phone = customer.phone;
        effects.add("order-confirmation-whatsapp", () =>
          queueNotification({ type: "ORDER_CONFIRMATION", channel: "WHATSAPP", recipient: phone, userId: order.userId, orderId: order.id, templateData }),
        );
      }
      effects.add("cancel-reservation-expiry", () => cancelReservationExpiry(order.id));
      return "fulfilled";
    });
    await effects.flush();
    logger.info({ orderId: located.orderId, outcome }, "payment success processed");
    return outcome;
  });
}

export interface PaymentFailedEvent {
  provider: PaymentProvider;
  providerOrderId: string;
  orderIdHint: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  /**
   * Terminal = the provider will not accept another attempt on this session (Stripe
   * payment_intent.canceled). Non-terminal failures (declined card) keep the reservation so the
   * customer can retry within the 15-minute window.
   */
  terminal: boolean;
}

export async function handlePaymentFailed(event: PaymentFailedEvent): Promise<"recorded" | "ignored"> {
  const located = await findPayment(event.provider, event.providerOrderId, event.orderIdHint);
  if (!located) return "ignored";

  const recorded = await withOrderLock(located.orderId, () =>
    withTransaction(async (tx) => {
      const order = await lockOrder(tx, located.orderId);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: located.id }, select: { status: true } });
      if (!order || (SETTLED as readonly string[]).includes(payment.status) || payment.status === "CANCELLED") {
        return false;
      }
      await tx.payment.update({
        where: { id: located.id },
        data: {
          status: "FAILED",
          failureCode: event.failureCode?.slice(0, 64) ?? null,
          failureMessage: event.failureMessage?.slice(0, 500) ?? null,
        },
      });
      return order.status === "PENDING_PAYMENT";
    }),
  );

  if (recorded && event.terminal) {
    // The inventory worker releases stock + coupon atomically.
    await enqueueImmediateRelease(located.orderId);
  }
  return recorded ? "recorded" : "ignored";
}

/** Sends a PENDING refund to its provider and records the outcome. Safe to retry. */
export async function executeRefund(refundId: string): Promise<void> {
  const refund = await db.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: { payment: { select: { providerOrderId: true, providerPaymentId: true } } },
  });
  if (refund.status !== "PENDING" || refund.providerRefundId) return;
  if (!refund.payment.providerOrderId) {
    throw new Error(`Refund ${refundId}: payment has no provider order id`);
  }
  const outcome = await getPaymentGateway(refund.provider).refund({
    providerOrderId: refund.payment.providerOrderId,
    providerPaymentId: refund.payment.providerPaymentId,
    amountMinor: refund.amountMinor,
    idempotencyKey: refund.idempotencyKey,
    reason: refund.reason,
    refundId: refund.id,
  });
  await db.refund.update({ where: { id: refund.id }, data: { providerRefundId: outcome.providerRefundId } });
  if (outcome.status !== "PENDING") {
    await applyRefundStatus(refund.id, outcome.status);
  }
}

export interface RefundUpdatedEvent {
  provider: PaymentProvider;
  providerRefundId: string;
  /** Our Refund id from provider metadata/notes. */
  refundIdHint: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
}

export async function handleRefundUpdated(event: RefundUpdatedEvent): Promise<"updated" | "ignored"> {
  const refund =
    (await db.refund.findUnique({
      where: { provider_providerRefundId: { provider: event.provider, providerRefundId: event.providerRefundId } },
      select: { id: true },
    })) ?? (event.refundIdHint ? await db.refund.findUnique({ where: { id: event.refundIdHint }, select: { id: true } }) : null);
  if (!refund || event.status === "PENDING") return "ignored";
  await db.refund.update({ where: { id: refund.id }, data: { providerRefundId: event.providerRefundId } }).catch(() => undefined);
  return (await applyRefundStatus(refund.id, event.status)) ? "updated" : "ignored";
}

/**
 * Moves a refund to its final status exactly once; on success adds the amount to the payment
 * and sets PARTIALLY_REFUNDED / REFUNDED.
 */
async function applyRefundStatus(refundId: string, status: "SUCCEEDED" | "FAILED"): Promise<boolean> {
  const applied = await applyRefundStatusInTx(refundId, status);
  if (applied && status === "SUCCEEDED") {
    // GST credit note against the original invoice; the hourly sweep retries if Redis is down.
    await enqueueCreditNote(refundId).catch((error: unknown) => logger.error({ err: error, refundId }, "credit note not queued"));
  }
  return applied;
}

async function applyRefundStatusInTx(refundId: string, status: "SUCCEEDED" | "FAILED"): Promise<boolean> {
  return withTransaction(async (tx) => {
    const transitioned = await tx.refund.updateMany({
      where: { id: refundId, status: "PENDING" },
      data: { status, processedAt: new Date() },
    });
    if (transitioned.count === 0) return false;
    if (status === "SUCCEEDED") {
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, select: { paymentId: true, amountMinor: true } });
      const payment = await tx.payment.update({
        where: { id: refund.paymentId },
        data: { amountRefundedMinor: { increment: refund.amountMinor } },
        select: { id: true, amountMinor: true, amountRefundedMinor: true },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: payment.amountRefundedMinor >= payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
    }
    return true;
  });
}

export function toCurrencyCode(value: string): Currency | null {
  const upper = value.toUpperCase();
  return upper === "INR" || upper === "USD" ? upper : null;
}
