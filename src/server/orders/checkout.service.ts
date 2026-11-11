import type { Currency, OrderStatus, PaymentMethodType, PaymentProvider, Prisma } from "@prisma/client";
import { env } from "@/env";
import { ApiError, Errors } from "@/lib/api/errors";
import { randomBase32, sha256Hex } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PostCommitEffects } from "@/lib/post-commit";
import { isRedisAvailable, withLock } from "@/lib/redis";
import { scheduleReservationExpiry } from "@/queues";
import { DELIVERY_SLOTS, type DeliverySlot } from "@/schemas/checkout";
import { priceCart } from "@/server/cart/pricing";
import { CouponUnavailableError, reserveCouponRedemption } from "@/server/coupons/coupon.service";
import { InsufficientStockError, RESERVATION_TTL_MS, reserveStock } from "@/server/inventory/reservation.service";
import { getPaymentGateway, type PaymentSession } from "@/server/payments";
import { cancelPendingOrder } from "./expiry.service";

/**
 * Checkout = Step 3 "Pay Now":
 *  1. one transaction creates the PENDING_PAYMENT order (snapshots of prices, address, shipping),
 *     reserves stock with row locks, reserves the coupon use and creates the Payment row;
 *  2. the provider session (Stripe PaymentIntent / Razorpay order) is created after commit;
 *  3. a delayed BullMQ job releases everything 15 minutes later unless a verified payment
 *     webhook consumed the reservation first.
 * The client sends only ids: every amount is computed on the server.
 */

export { DELIVERY_SLOTS };
const SCHEDULE_MIN_DAYS = 1;
const SCHEDULE_MAX_DAYS = 14;

export interface CheckoutRequest {
  userId: string;
  idempotencyKey: string;
  addressId: string;
  shippingMethodCode: string;
  scheduledDate?: string | undefined;
  scheduledSlot?: DeliverySlot | undefined;
  provider: PaymentProvider;
  paymentMethod?: PaymentMethodType | undefined;
  customerNote?: string | undefined;
  customerGstin?: string | undefined;
}

export interface CheckoutResponse {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  currency: Currency;
  totals: { subtotalMinor: number; discountMinor: number; taxMinor: number; shippingMinor: number; totalMinor: number };
  reservationExpiresAt: string;
  payment: PaymentSession;
}

/** Order idempotency key: scoped to the user so two customers can never collide. */
export function orderIdempotencyKey(userId: string, key: string): string {
  return sha256Hex(`${userId}:${key}`);
}

function newOrderNumber(): string {
  return `CLB-${new Date().getUTCFullYear().toString().slice(2)}${randomBase32(10)}`;
}

function parseScheduledDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Errors.unprocessable("invalid_delivery_date", "Choose a valid delivery date.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  const today = new Date();
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((date.getTime() - startOfToday) / 86_400_000);
  if (Number.isNaN(date.getTime()) || days < SCHEDULE_MIN_DAYS || days > SCHEDULE_MAX_DAYS) {
    throw Errors.unprocessable(
      "invalid_delivery_date",
      `Scheduled delivery must be between ${SCHEDULE_MIN_DAYS} and ${SCHEDULE_MAX_DAYS} days from today.`,
    );
  }
  return date;
}

export interface PendingOrder {
  orderId: string;
  orderNumber: string;
  paymentId: string;
  paymentIdempotencyKey: string;
  currency: Currency;
  totals: CheckoutResponse["totals"];
  reservationExpiresAt: Date;
  customer: { name: string | null; email: string | null; phone: string | null };
}

/** Step 1: the database part of checkout (exported for tests). */
export async function placePendingOrder(request: CheckoutRequest): Promise<PendingOrder> {
  const idempotencyKey = orderIdempotencyKey(request.userId, request.idempotencyKey);
  const [user, cart, address] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: request.userId }, select: { name: true, email: true, phone: true, isActive: true } }),
    db.cart.findUnique({
      where: { userId: request.userId },
      select: { couponCode: true, items: { orderBy: { createdAt: "asc" }, select: { variantId: true, quantity: true } } },
    }),
    db.address.findFirst({ where: { id: request.addressId, userId: request.userId } }),
  ]);
  if (!user.isActive) throw Errors.forbidden();
  if (!cart || cart.items.length === 0) throw Errors.unprocessable("cart_empty", "Your cart is empty.");
  if (!address) throw Errors.notFound("Address");

  const scheduledDate = request.scheduledDate ? parseScheduledDate(request.scheduledDate) : null;
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
  const effects = new PostCommitEffects();

  try {
    const pending = await withTransaction(async (tx): Promise<PendingOrder> => {
      const priced = await priceCart({
        lines: cart.items,
        couponCode: cart.couponCode,
        userId: request.userId,
        shippingMethodCode: request.shippingMethodCode,
        client: tx,
      });

      if (!priced.isCheckoutReady) {
        throw Errors.conflict(
          "cart_not_ready",
          "Some items in your cart are unavailable or short on stock.",
          priced.lines.filter((line) => line.issue).map((line) => ({ variantId: line.variantId, sku: line.sku, issue: line.issue, available: line.available })),
        );
      }
      if (priced.coupon && !priced.coupon.applied) {
        throw Errors.unprocessable("coupon_invalid", priced.coupon.message, { code: priced.coupon.code, reason: priced.coupon.reason });
      }
      const shipping = priced.shipping;
      if (!shipping) {
        throw Errors.unprocessable("invalid_shipping_method", "That delivery option is not available.");
      }
      if (shipping.requiresSlot && (!scheduledDate || !request.scheduledSlot)) {
        throw Errors.unprocessable("delivery_slot_required", "Choose a delivery date and time slot.");
      }
      if (priced.totalMinor <= 0) {
        throw Errors.unprocessable("invalid_total", "This order cannot be paid online.");
      }

      const estimatedDeliveryAt =
        shipping.requiresSlot && scheduledDate ? scheduledDate : new Date(Date.now() + shipping.maxDays * 86_400_000);

      const addressSnapshot: Prisma.InputJsonObject = {
        type: address.type,
        label: address.label,
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        countryCode: address.countryCode,
      };

      const order = await tx.order.create({
        data: {
          orderNumber: newOrderNumber(),
          userId: request.userId,
          status: "PENDING_PAYMENT",
          currency: priced.currency,
          subtotalMinor: priced.subtotalMinor,
          discountMinor: priced.discountMinor,
          taxMinor: priced.taxMinor,
          shippingMinor: priced.shippingMinor,
          totalMinor: priced.totalMinor,
          couponId: priced.coupon?.applied ? priced.coupon.couponId : null,
          couponCode: priced.coupon?.applied ? priced.coupon.code : null,
          shippingAddress: addressSnapshot,
          shippingMethodId: shipping.id,
          shippingMethodName: shipping.name,
          scheduledDeliveryDate: shipping.requiresSlot ? scheduledDate : null,
          scheduledSlot: shipping.requiresSlot ? (request.scheduledSlot ?? null) : null,
          estimatedDeliveryAt,
          customerNote: request.customerNote ?? null,
          customerGstin: request.customerGstin ?? null,
          idempotencyKey,
          items: {
            create: priced.lines.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              productName: line.productName,
              variantTitle: line.variantTitle,
              sku: line.sku,
              imageKey: line.imageKey,
              hsnCode: line.hsnCode,
              unitPriceMinor: line.unitPriceMinor,
              compareAtPriceMinor: line.compareAtPriceMinor,
              quantity: line.quantity,
              discountMinor: line.discountMinor,
              taxRateBps: line.taxRateBps,
              taxMinor: line.taxMinor,
              lineTotalMinor: line.lineTotalMinor,
            })),
          },
          statusHistory: { create: { toStatus: "PENDING_PAYMENT", note: "checkout started" } },
        },
        select: { id: true, orderNumber: true },
      });

      await reserveStock(tx, {
        orderId: order.id,
        lines: priced.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
        expiresAt,
        effects,
      });

      if (priced.coupon?.applied) {
        await reserveCouponRedemption(tx, {
          couponId: priced.coupon.couponId,
          userId: request.userId,
          orderId: order.id,
          discountMinor: priced.coupon.discountMinor,
          usageLimitPerUser: priced.coupon.usageLimitPerUser,
        });
      }

      const paymentIdempotencyKey = `${idempotencyKey}-pay`;
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: request.provider,
          method: request.paymentMethod ?? null,
          amountMinor: priced.totalMinor,
          currency: priced.currency,
          idempotencyKey: paymentIdempotencyKey,
        },
        select: { id: true },
      });

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        paymentId: payment.id,
        paymentIdempotencyKey,
        currency: priced.currency,
        totals: {
          subtotalMinor: priced.subtotalMinor,
          discountMinor: priced.discountMinor,
          taxMinor: priced.taxMinor,
          shippingMinor: priced.shippingMinor,
          totalMinor: priced.totalMinor,
        },
        reservationExpiresAt: expiresAt,
        customer: { name: address.fullName || user.name, email: user.email, phone: address.phone || user.phone },
      };
    });

    await effects.flush();
    try {
      await scheduleReservationExpiry(pending.orderId, pending.reservationExpiresAt);
    } catch (error) {
      // The once-a-minute sweeper releases it instead.
      logger.error({ err: error, orderId: pending.orderId }, "failed to schedule reservation expiry; sweeper will handle it");
    }
    return pending;
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      throw Errors.conflict("insufficient_stock", "Some items sold out while you were checking out.", error.shortages);
    }
    if (error instanceof CouponUnavailableError) {
      throw Errors.unprocessable(error.reason, error.message);
    }
    throw error;
  }
}

/** Step 2: provider session. On failure the order is cancelled and stock released immediately. */
async function initiatePayment(pending: PendingOrder, provider: PaymentProvider, method: PaymentMethodType | null): Promise<PaymentSession> {
  let session: PaymentSession;
  try {
    session = await getPaymentGateway(provider).createSession({
      orderId: pending.orderId,
      orderNumber: pending.orderNumber,
      amountMinor: pending.totals.totalMinor,
      currency: pending.currency,
      idempotencyKey: pending.paymentIdempotencyKey,
      method,
      customer: pending.customer,
    });
  } catch (error) {
    logger.error({ err: error, orderId: pending.orderId, provider }, "payment session creation failed");
    await cancelPendingOrder(pending.orderId, "payment_initiation_failed").catch((cancelError: unknown) =>
      logger.error({ err: cancelError, orderId: pending.orderId }, "failed to cancel order after payment init failure"),
    );
    throw Errors.badGateway("The payment provider is unavailable. Please try again.");
  }
  await db.payment.update({
    where: { id: pending.paymentId },
    data: { providerOrderId: session.providerOrderId, status: "PENDING" },
  });
  return session;
}

/**
 * Recovers a checkout whose order already exists for this idempotency key (e.g. the process
 * died after commit, or Redis lost the idempotency record). Stripe sessions are re-fetched
 * through Stripe's own idempotency; Razorpay sessions are rebuilt from stored ids.
 */
async function resumeCheckout(orderId: string, request: CheckoutRequest): Promise<CheckoutResponse> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      reservations: { orderBy: { expiresAt: "asc" }, take: 1, select: { expiresAt: true } },
      user: { select: { name: true, email: true, phone: true } },
    },
  });
  const payment = order.payments[0];
  if (order.status !== "PENDING_PAYMENT" || !payment) {
    throw new ApiError(409, "checkout_already_finalized", "This checkout has already been completed or cancelled.", {
      orderNumber: order.orderNumber,
      status: order.status,
    });
  }
  const reservationExpiresAt = order.reservations[0]?.expiresAt ?? new Date(order.createdAt.getTime() + RESERVATION_TTL_MS);
  const pending: PendingOrder = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    paymentId: payment.id,
    paymentIdempotencyKey: payment.idempotencyKey,
    currency: order.currency,
    totals: {
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      shippingMinor: order.shippingMinor,
      totalMinor: order.totalMinor,
    },
    reservationExpiresAt,
    customer: { name: order.user.name, email: order.user.email, phone: order.user.phone },
  };

  let session: PaymentSession;
  if (payment.providerOrderId && payment.provider === "RAZORPAY") {
    session = {
      provider: "RAZORPAY",
      providerOrderId: payment.providerOrderId,
      keyId: env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      orderNumber: order.orderNumber,
      prefill: { name: order.user.name, email: order.user.email, contact: order.user.phone },
    };
  } else {
    session = await initiatePayment(pending, payment.provider, payment.method ?? request.paymentMethod ?? null);
  }
  return toResponse(pending, session);
}

function toResponse(pending: PendingOrder, session: PaymentSession): CheckoutResponse {
  return {
    orderId: pending.orderId,
    orderNumber: pending.orderNumber,
    status: "PENDING_PAYMENT",
    currency: pending.currency,
    totals: pending.totals,
    reservationExpiresAt: pending.reservationExpiresAt.toISOString(),
    payment: session,
  };
}

/** Full checkout, serialised per user (one checkout at a time per account). */
export async function startCheckout(request: CheckoutRequest): Promise<CheckoutResponse> {
  if (!isRedisAvailable()) {
    throw Errors.unavailable("Checkout is temporarily unavailable. Please retry in a moment.");
  }
  return withLock(
    `checkout:${request.userId}`,
    async () => {
      const existing = await db.order.findUnique({
        where: { idempotencyKey: orderIdempotencyKey(request.userId, request.idempotencyKey) },
        select: { id: true },
      });
      if (existing) {
        return resumeCheckout(existing.id, request);
      }
      const pending = await placePendingOrder(request);
      const session = await initiatePayment(pending, request.provider, request.paymentMethod ?? null);
      return toResponse(pending, session);
    },
    { ttlMs: 30_000, retryCount: 0 },
  );
}
