import { createHash } from "node:crypto";
import type { OrderStatus, Prisma } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { hasPermission } from "@/lib/auth/rbac";
import { db, isUniqueConstraintError, withTransaction, type TransactionClient } from "@/lib/db";
import { resolveImageUrl } from "@/lib/images";
import { logger } from "@/lib/logger";
import { PostCommitEffects } from "@/lib/post-commit";
import { CacheTags, invalidateCacheTags } from "@/lib/redis";
import { enqueueRefundExecution } from "@/queues";
import {
  ORDER_TRANSITIONS,
  orderTransitionSchema,
  PRE_DISPATCH_STATUSES,
  refundRequestSchema,
  trackingSchema,
  type OrderStatusValue,
  type OrderTransitionRequest,
  type RefundRequest,
} from "@/schemas/admin";
import { releaseCouponRedemption } from "@/server/coupons/coupon.service";
import { restockUnits } from "@/server/inventory/reservation.service";
import { queueOrderNotification } from "@/server/notifications/notify";
import { cancelPendingOrder } from "@/server/orders/expiry.service";
import { lockOrder, transitionOrder, withOrderLock } from "@/server/orders/order-lock";
import { writeAudit } from "./audit";
import type { AdminContext } from "./context";

/**
 * Order & fulfilment manager. Every change runs under the per-order Redis lock plus a row lock
 * (the same guards the payment webhooks use), so an admin action can never interleave with a
 * late payment or an expiry job.
 */

export const ORDER_VIEWS = {
  all: { label: "All", statuses: null },
  fulfil: { label: "To fulfil", statuses: ["PLACED", "CONFIRMED", "PACKED"] },
  transit: { label: "In transit", statuses: ["SHIPPED", "OUT_FOR_DELIVERY"] },
  delivered: { label: "Delivered", statuses: ["DELIVERED"] },
  returns: { label: "Returned", statuses: ["RETURNED"] },
  cancelled: { label: "Cancelled", statuses: ["CANCELLED", "PAYMENT_FAILED"] },
  pending: { label: "Awaiting payment", statuses: ["PENDING_PAYMENT"] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] | null }>;
export type OrderView = keyof typeof ORDER_VIEWS;

const SETTLED_PAYMENT = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

// ============================================================================ list

export interface AdminOrderRow {
  orderNumber: string;
  createdAt: string;
  status: OrderStatus;
  customerName: string | null;
  customerEmail: string | null;
  itemCount: number;
  totalMinor: number;
  currency: string;
  paymentStatus: string | null;
  paymentProvider: string | null;
  shippingMethodName: string;
  refundedMinor: number;
}

export async function listAdminOrders(input: { q?: string | undefined; view: OrderView; from?: Date | undefined; to?: Date | undefined; page: number }) {
  const q = input.q?.trim();
  const statuses = ORDER_VIEWS[input.view].statuses;
  const base: Prisma.OrderWhereInput = {
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q.toUpperCase() } },
            { user: { email: { contains: q.toLowerCase() } } },
            { user: { phone: { contains: q.replace(/\s+/g, "") } } },
            { user: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const where: Prisma.OrderWhereInput = { ...base, ...(statuses ? { status: { in: [...statuses] } } : {}) };
  const pageSize = 25;
  const [total, grouped] = await Promise.all([db.order.count({ where }), db.order.groupBy({ by: ["status"], where: base, _count: { _all: true } })]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      orderNumber: true,
      createdAt: true,
      status: true,
      totalMinor: true,
      currency: true,
      shippingMethodName: true,
      user: { select: { name: true, email: true } },
      _count: { select: { items: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, provider: true, amountRefundedMinor: true } },
    },
  });
  const countByStatus = new Map(grouped.map((group) => [group.status, group._count._all]));
  const counts = Object.fromEntries(
    (Object.keys(ORDER_VIEWS) as OrderView[]).map((view) => {
      const list = ORDER_VIEWS[view].statuses;
      const count = list ? list.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0) : [...countByStatus.values()].reduce((a, b) => a + b, 0);
      return [view, count];
    }),
  ) as Record<OrderView, number>;

  return {
    total,
    page,
    pageCount,
    counts,
    rows: orders.map(
      (order): AdminOrderRow => ({
        orderNumber: order.orderNumber,
        createdAt: order.createdAt.toISOString(),
        status: order.status,
        customerName: order.user.name,
        customerEmail: order.user.email,
        itemCount: order._count.items,
        totalMinor: order.totalMinor,
        currency: order.currency,
        paymentStatus: order.payments[0]?.status ?? null,
        paymentProvider: order.payments[0]?.provider ?? null,
        shippingMethodName: order.shippingMethodName,
        refundedMinor: order.payments[0]?.amountRefundedMinor ?? 0,
      }),
    ),
  };
}

// ============================================================================ detail

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  allowedTransitions: OrderStatusValue[];
  currency: string;
  createdAt: string;
  placedAt: string | null;
  totals: { subtotalMinor: number; discountMinor: number; taxMinor: number; shippingMinor: number; totalMinor: number };
  couponCode: string | null;
  customer: { id: string; name: string | null; email: string | null; phone: string | null; orderCount: number };
  shippingAddress: Record<string, unknown>;
  shipping: {
    methodName: string;
    scheduledDate: string | null;
    scheduledSlot: string | null;
    carrierName: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  };
  customerNote: string | null;
  cancelReason: string | null;
  items: Array<{
    id: string;
    productName: string;
    variantTitle: string;
    sku: string;
    imageUrl: string | null;
    quantity: number;
    refundedQuantity: number;
    serialNumbers: string[];
    unitPriceMinor: number;
    discountMinor: number;
    taxMinor: number;
    lineTotalMinor: number;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    method: string | null;
    status: string;
    amountMinor: number;
    amountRefundedMinor: number;
    providerPaymentId: string | null;
    failureMessage: string | null;
    createdAt: string;
  }>;
  refunds: Array<{ id: string; amountMinor: number; status: string; reason: string; createdAt: string; processedAt: string | null; initiatedBy: string | null }>;
  /** Settled amount minus pending and successful refunds. */
  refundableMinor: number;
  returns: Array<{ id: string; rmaNumber: string; type: string; status: string; quantity: number; reason: string; description: string | null; resolutionNote: string | null; item: string; createdAt: string }>;
  creditNotes: Array<{ id: string; creditNoteNumber: string; amountMinor: number; issuedAt: string }>;
  customerGstin: string | null;
  history: Array<{ id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; actor: string | null; createdAt: string }>;
  invoiceNumber: string | null;
}

export async function getAdminOrder(orderNumber: string): Promise<AdminOrderDetail | null> {
  const order = await db.order.findUnique({
    where: { orderNumber },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, _count: { select: { orders: true } } } },
      items: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "desc" } },
      refunds: { orderBy: { createdAt: "desc" }, include: { initiatedBy: { select: { name: true, email: true } } } },
      statusHistory: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, email: true } } } },
      returnRequests: { orderBy: { createdAt: "desc" }, include: { orderItem: { select: { productName: true, variantTitle: true } } } },
      creditNotes: { orderBy: { issuedAt: "asc" }, select: { id: true, creditNoteNumber: true, amountMinor: true, issuedAt: true } },
    },
  });
  if (!order) return null;
  const settled = order.payments.find((payment) => (SETTLED_PAYMENT as readonly string[]).includes(payment.status));
  const committedRefunds = order.refunds.filter((refund) => refund.status !== "FAILED").reduce((sum, refund) => sum + refund.amountMinor, 0);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    allowedTransitions: [...ORDER_TRANSITIONS[order.status]],
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    placedAt: order.placedAt?.toISOString() ?? null,
    totals: {
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      shippingMinor: order.shippingMinor,
      totalMinor: order.totalMinor,
    },
    couponCode: order.couponCode,
    customer: { id: order.user.id, name: order.user.name, email: order.user.email, phone: order.user.phone, orderCount: order.user._count.orders },
    shippingAddress: (order.shippingAddress ?? {}) as Record<string, unknown>,
    shipping: {
      methodName: order.shippingMethodName,
      scheduledDate: order.scheduledDeliveryDate?.toISOString().slice(0, 10) ?? null,
      scheduledSlot: order.scheduledSlot,
      carrierName: order.carrierName,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    },
    customerNote: order.customerNote,
    cancelReason: order.cancelReason,
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantTitle: item.variantTitle,
      sku: item.sku,
      imageUrl: resolveImageUrl(item.imageKey),
      quantity: item.quantity,
      refundedQuantity: item.refundedQuantity,
      serialNumbers: item.serialNumbers,
      unitPriceMinor: item.unitPriceMinor,
      discountMinor: item.discountMinor,
      taxMinor: item.taxMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      method: payment.method,
      status: payment.status,
      amountMinor: payment.amountMinor,
      amountRefundedMinor: payment.amountRefundedMinor,
      providerPaymentId: payment.providerPaymentId,
      failureMessage: payment.failureMessage,
      createdAt: payment.createdAt.toISOString(),
    })),
    refunds: order.refunds.map((refund) => ({
      id: refund.id,
      amountMinor: refund.amountMinor,
      status: refund.status,
      reason: refund.reason,
      createdAt: refund.createdAt.toISOString(),
      processedAt: refund.processedAt?.toISOString() ?? null,
      initiatedBy: refund.initiatedBy ? (refund.initiatedBy.name ?? refund.initiatedBy.email) : null,
    })),
    refundableMinor: settled ? Math.max(0, settled.amountMinor - committedRefunds) : 0,
    history: order.statusHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      note: entry.note,
      actor: entry.actor ? (entry.actor.name ?? entry.actor.email) : null,
      createdAt: entry.createdAt.toISOString(),
    })),
    invoiceNumber: order.invoiceNumber,
    customerGstin: order.customerGstin,
    returns: order.returnRequests.map((request) => ({
      id: request.id,
      rmaNumber: request.rmaNumber,
      type: request.type,
      status: request.status,
      quantity: request.quantity,
      reason: request.reason,
      description: request.description,
      resolutionNote: request.resolutionNote,
      item: `${request.orderItem.productName} (${request.orderItem.variantTitle})`,
      createdAt: request.createdAt.toISOString(),
    })),
    creditNotes: order.creditNotes.map((note) => ({ id: note.id, creditNoteNumber: note.creditNoteNumber, amountMinor: note.amountMinor, issuedAt: note.issuedAt.toISOString() })),
  };
}

// ============================================================================ internals

async function findOrderId(orderNumber: string): Promise<string> {
  const order = await db.order.findUnique({ where: { orderNumber }, select: { id: true } });
  if (!order) throw Errors.notFound("Order");
  return order.id;
}

/** Settled payment + amount still refundable (pending refunds count as committed). */
async function refundableState(tx: TransactionClient, orderId: string) {
  const payment = await tx.payment.findFirst({
    where: { orderId, status: { in: [...SETTLED_PAYMENT] } },
    select: { id: true, provider: true, amountMinor: true, currency: true },
  });
  if (!payment) return { payment: null, refundableMinor: 0 };
  const committed = await tx.refund.aggregate({ where: { paymentId: payment.id, status: { in: ["PENDING", "SUCCEEDED"] } }, _sum: { amountMinor: true } });
  return { payment, refundableMinor: Math.max(0, payment.amountMinor - (committed._sum.amountMinor ?? 0)) };
}

/** Units of each line not yet put back into stock for this order. */
async function unrestockedLines(tx: TransactionClient, orderId: string): Promise<Array<{ variantId: string; quantity: number }>> {
  const [items, restocked] = await Promise.all([
    tx.orderItem.findMany({ where: { orderId }, select: { variantId: true, quantity: true } }),
    tx.stockMovementLog.groupBy({
      by: ["variantId"],
      where: { orderId, type: { in: ["ORDER_CANCELLATION", "CUSTOMER_RETURN"] } },
      _sum: { onHandDelta: true },
    }),
  ]);
  const done = new Map(restocked.map((row) => [row.variantId, row._sum.onHandDelta ?? 0]));
  const sold = new Map<string, number>();
  for (const item of items) sold.set(item.variantId, (sold.get(item.variantId) ?? 0) + item.quantity);
  return [...sold.entries()]
    .map(([variantId, quantity]) => ({ variantId, quantity: quantity - (done.get(variantId) ?? 0) }))
    .filter((line) => line.quantity > 0);
}

async function createRefundRecord(
  tx: TransactionClient,
  ctx: AdminContext,
  input: {
    orderId: string;
    payment: { id: string; provider: "STRIPE" | "RAZORPAY" };
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
    /** Item-mode only: what this refund decremented, so a FAILED refund can give it back. */
    lines: Array<{ orderItemId: string; variantId: string; quantity: number }>;
    /** Whether units were returned to stock by this refund. */
    restocked: boolean;
  },
) {
  const refund = await tx.refund.create({
    data: {
      paymentId: input.payment.id,
      orderId: input.orderId,
      provider: input.payment.provider,
      amountMinor: input.amountMinor,
      reason: input.reason.slice(0, 500),
      idempotencyKey: input.idempotencyKey,
      initiatedById: ctx.actor.id,
      lines: input.lines,
      restocked: input.restocked,
    },
    select: { id: true, amountMinor: true },
  });
  await writeAudit(tx, ctx, {
    action: "REFUND",
    entityType: "Order",
    entityId: input.orderId,
    after: { refundId: refund.id, amountMinor: refund.amountMinor },
    reason: input.reason,
  });
  return refund;
}

function idempotencyKeyFor(ctx: AdminContext, orderId: string, clientKey: string | null, purpose: string): string {
  const material = clientKey ? `${ctx.actor.id}:${clientKey}` : `${ctx.actor.id}:${purpose}:${Date.now()}`;
  return `admin-${orderId.slice(-10)}-${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

const STATUS_NOTIFICATIONS: Partial<Record<OrderStatus, "ORDER_SHIPPED" | "OUT_FOR_DELIVERY" | "ORDER_DELIVERED" | "ORDER_CONFIRMATION">> = {
  SHIPPED: "ORDER_SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "ORDER_DELIVERED",
};

/**
 * Stores device serial / IMEI numbers per order item (at most one per unit; duplicates are only
 * rejected within the order, since refurbished units can legitimately reappear later). The stored
 * invoice PDF is dropped so the next download re-renders with the serials (same invoice number).
 */
async function recordSerials(tx: TransactionClient, orderId: string, serials: Array<{ orderItemId: string; serialNumbers: string[] }>): Promise<number> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, sku: true, quantity: true } });
  let total = 0;
  for (const entry of serials) {
    const item = items.find((row) => row.id === entry.orderItemId);
    if (!item) throw Errors.unprocessable("invalid_items", "A serial number refers to an item that is not on this order.");
    if (entry.serialNumbers.length > item.quantity) {
      throw Errors.unprocessable("too_many_serials", `${item.sku} has ${item.quantity} unit(s) but ${entry.serialNumbers.length} serial numbers were entered.`);
    }
    await tx.orderItem.update({ where: { id: item.id }, data: { serialNumbers: entry.serialNumbers } });
    total += entry.serialNumbers.length;
  }
  await tx.order.update({ where: { id: orderId }, data: { invoiceStorageKey: null } });
  return total;
}

// ============================================================================ status transitions

export async function transitionOrderStatus(
  ctx: AdminContext,
  orderNumber: string,
  request: OrderTransitionRequest,
  clientIdempotencyKey: string | null,
): Promise<{ status: OrderStatus; refundId: string | null }> {
  const input = orderTransitionSchema.parse(request);
  const orderId = await findOrderId(orderNumber);

  // Unpaid orders: the existing expiry path releases the reservation and coupon atomically.
  const current = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  if (current.status === "PENDING_PAYMENT") {
    if (input.to !== "CANCELLED") throw Errors.conflict("invalid_transition", "An unpaid order can only be cancelled.");
    const outcome = await cancelPendingOrder(orderId, "cancelled_by_admin");
    if (outcome.status === "cancelled") {
      await withTransaction((tx) =>
        writeAudit(tx, ctx, {
          action: "ORDER_STATUS_CHANGE",
          entityType: "Order",
          entityId: orderId,
          before: { status: "PENDING_PAYMENT" },
          after: { status: "CANCELLED", unitsReleased: outcome.unitsReleased },
          reason: input.note,
        }),
      );
      return { status: "CANCELLED", refundId: null };
    }
    // A payment won the race: fall through and evaluate against the new status.
  }

  const effects = new PostCommitEffects();
  const result = await withOrderLock(orderId, () =>
    withTransaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (!order) throw Errors.notFound("Order");
      const from = order.status;
      if (!ORDER_TRANSITIONS[from].includes(input.to)) {
        throw Errors.conflict("invalid_transition", `An order that is ${from.toLowerCase().replace(/_/g, " ")} cannot move to ${input.to.toLowerCase().replace(/_/g, " ")}.`);
      }

      const cancellingPaid = input.to === "CANCELLED" && PRE_DISPATCH_STATUSES.includes(from);
      const refunding = cancellingPaid || (input.to === "RETURNED" && input.refundRemaining);
      if (refunding && !hasPermission(ctx.actor.role, "refunds:issue")) {
        throw Errors.forbidden();
      }

      if (input.to === "SHIPPED") {
        const existing = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { carrierName: true, trackingNumber: true, trackingUrl: true } });
        const tracking = input.tracking ?? (existing.carrierName && existing.trackingNumber ? trackingSchema.parse({ ...existing, trackingUrl: existing.trackingUrl ?? "" }) : null);
        if (!tracking) throw Errors.unprocessable("tracking_required", "Add the carrier and tracking number before marking the order shipped.");
        await tx.order.update({ where: { id: orderId }, data: tracking });
      }

      let serialsRecorded = 0;
      if (input.serials?.length) {
        if (input.to !== "PACKED" && input.to !== "SHIPPED") {
          throw Errors.unprocessable("serials_not_allowed", "Serial / IMEI numbers are recorded when the order is packed or shipped.");
        }
        serialsRecorded = await recordSerials(tx, orderId, input.serials);
      }

      await transitionOrder(tx, {
        orderId,
        from,
        to: input.to,
        note: input.note ?? `by ${ctx.actor.name ?? ctx.actor.email ?? "admin"}`,
        actorId: ctx.actor.id,
        ...(input.to === "CANCELLED" ? { cancelReason: input.note ?? "cancelled_by_admin" } : {}),
      });

      let unitsRestocked = 0;
      if (cancellingPaid || (input.to === "RETURNED" && input.restock)) {
        const lines = await unrestockedLines(tx, orderId);
        if (lines.length > 0) {
          unitsRestocked = await restockUnits(tx, {
            orderId,
            lines,
            type: cancellingPaid ? "ORDER_CANCELLATION" : "CUSTOMER_RETURN",
            note: `${order.orderNumber} ${cancellingPaid ? "cancelled before dispatch" : "returned"}`,
            actorId: ctx.actor.id,
            effects,
          });
        }
      }

      if (cancellingPaid) {
        await releaseCouponRedemption(tx, orderId);
        const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true, quantity: true } });
        const units = new Map<string, number>();
        for (const item of items) units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
        for (const [productId, quantity] of units) {
          await tx.$executeRaw`UPDATE "Product" SET "salesCount" = GREATEST(0, "salesCount" - ${quantity}) WHERE id = ${productId}`;
        }
      }

      let refundId: string | null = null;
      if (refunding) {
        const { payment, refundableMinor } = await refundableState(tx, orderId);
        if (payment && refundableMinor > 0) {
          const refund = await createRefundRecord(tx, ctx, {
            orderId,
            payment,
            amountMinor: refundableMinor,
            reason: input.note ?? (cancellingPaid ? "Order cancelled before dispatch" : "Order returned"),
            idempotencyKey: idempotencyKeyFor(ctx, orderId, clientIdempotencyKey, `transition-${input.to}`),
            // A cancellation/return refund covers the whole order; the units were handled above by
            // restockUnits, so there is nothing item-level to reverse here.
            lines: [],
            restocked: false,
          });
          refundId = refund.id;
          effects.add(`refund-${refund.id}`, () => enqueueRefundExecution(refund.id));
          effects.add(`refund-notice-${refund.id}`, () => queueOrderNotification({ orderId, type: "REFUND_ISSUED", templateData: { refundMinor: refund.amountMinor } }));
        }
      }

      await writeAudit(tx, ctx, {
        action: "ORDER_STATUS_CHANGE",
        entityType: "Order",
        entityId: orderId,
        before: { status: from },
        after: { status: input.to, unitsRestocked, refundId, ...(input.tracking ? { tracking: input.tracking } : {}), ...(serialsRecorded ? { serials: input.serials } : {}) },
        reason: input.note,
      });

      const notification = STATUS_NOTIFICATIONS[input.to];
      if (notification) effects.add(`notify-${input.to}`, () => queueOrderNotification({ orderId, type: notification }));
      if (unitsRestocked > 0 || cancellingPaid) {
        effects.add("invalidate-catalog", () => invalidateCacheTags([CacheTags.catalog(), CacheTags.home()]));
      }
      return { status: input.to as OrderStatus, refundId };
    }),
  ).catch((error: unknown) => {
    if (isUniqueConstraintError(error, "idempotencyKey")) throw Errors.conflict("duplicate_request", "This action was already submitted.");
    throw error;
  });
  await effects.flush();
  logger.info({ orderNumber, to: result.status, actorId: ctx.actor.id }, "admin order transition");
  return result;
}

export async function updateTracking(ctx: AdminContext, orderNumber: string, request: unknown): Promise<void> {
  const tracking = trackingSchema.parse(request);
  const orderId = await findOrderId(orderNumber);
  await withOrderLock(orderId, () =>
    withTransaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (!order) throw Errors.notFound("Order");
      if (["CANCELLED", "PAYMENT_FAILED", "PENDING_PAYMENT", "RETURNED"].includes(order.status)) {
        throw Errors.conflict("invalid_state", "Tracking cannot be changed on this order.");
      }
      const before = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { carrierName: true, trackingNumber: true, trackingUrl: true } });
      await tx.order.update({ where: { id: orderId }, data: tracking });
      await writeAudit(tx, ctx, { action: "UPDATE", entityType: "Order", entityId: orderId, before, after: tracking, reason: "tracking updated" });
    }),
  );
}

// ============================================================================ refunds

/** floor-telescoping share of a line total, so per-unit refunds can never exceed the line. */
function lineShare(lineTotalMinor: number, quantity: number, alreadyRefunded: number, refundQuantity: number): number {
  const upTo = (units: number) => Math.floor((lineTotalMinor * units) / quantity);
  return upTo(alreadyRefunded + refundQuantity) - upTo(alreadyRefunded);
}

export async function createRefund(
  ctx: AdminContext,
  orderNumber: string,
  request: RefundRequest,
  clientIdempotencyKey: string | null,
): Promise<{ refundId: string; amountMinor: number }> {
  const input = refundRequestSchema.parse(request);
  const orderId = await findOrderId(orderNumber);
  const idempotencyKey = idempotencyKeyFor(ctx, orderId, clientIdempotencyKey, "refund");

  const replay = await db.refund.findUnique({ where: { idempotencyKey }, select: { id: true, amountMinor: true } });
  if (replay) return { refundId: replay.id, amountMinor: replay.amountMinor };

  const effects = new PostCommitEffects();
  const result = await withOrderLock(orderId, () =>
    withTransaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (!order) throw Errors.notFound("Order");
      const { payment, refundableMinor } = await refundableState(tx, orderId);
      if (!payment) throw Errors.unprocessable("not_paid", "This order has no captured payment to refund.");
      if (refundableMinor <= 0) throw Errors.unprocessable("fully_refunded", "Everything on this order has already been refunded.");

      let amountMinor: number;
      const restockLines: Array<{ variantId: string; quantity: number }> = [];
      const refundLines: Array<{ orderItemId: string; variantId: string; quantity: number }> = [];
      if (input.mode === "items") {
        amountMinor = 0;
        const items = await tx.orderItem.findMany({ where: { orderId, id: { in: input.items.map((item) => item.orderItemId) } } });
        if (items.length !== new Set(input.items.map((item) => item.orderItemId)).size) {
          throw Errors.unprocessable("invalid_items", "An item does not belong to this order.");
        }
        for (const requested of input.items) {
          const item = items.find((row) => row.id === requested.orderItemId)!;
          const remaining = item.quantity - item.refundedQuantity;
          if (requested.quantity > remaining) {
            throw Errors.unprocessable("quantity_exceeded", `Only ${remaining} unit(s) of ${item.sku} can still be refunded.`);
          }
          amountMinor += lineShare(item.lineTotalMinor, item.quantity, item.refundedQuantity, requested.quantity);
          await tx.orderItem.update({ where: { id: item.id }, data: { refundedQuantity: { increment: requested.quantity } } });
          restockLines.push({ variantId: item.variantId, quantity: requested.quantity });
          refundLines.push({ orderItemId: item.id, variantId: item.variantId, quantity: requested.quantity });
        }
        amountMinor = Math.min(amountMinor, refundableMinor);
      } else {
        amountMinor = input.amountMinor!;
        if (amountMinor > refundableMinor) {
          throw Errors.unprocessable("amount_exceeded", `At most ${refundableMinor} can still be refunded on this order.`, { refundableMinor });
        }
      }
      if (amountMinor <= 0) throw Errors.unprocessable("nothing_to_refund", "The refund amount is zero.");

      if (input.restock && restockLines.length > 0) {
        if (["PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKED"].includes(order.status)) {
          throw Errors.unprocessable("not_dispatched", "Items that never left the warehouse are restocked by cancelling the order.");
        }
        await restockUnits(tx, { orderId, lines: restockLines, type: "CUSTOMER_RETURN", note: `${order.orderNumber} partial return`, actorId: ctx.actor.id, effects });
      }

      const refund = await createRefundRecord(tx, ctx, {
        orderId,
        payment,
        amountMinor,
        reason: input.reason,
        idempotencyKey,
        lines: refundLines,
        restocked: input.restock === true && restockLines.length > 0,
      });
      effects.add(`refund-${refund.id}`, () => enqueueRefundExecution(refund.id));
      effects.add(`refund-notice-${refund.id}`, () => queueOrderNotification({ orderId, type: "REFUND_ISSUED", templateData: { refundMinor: amountMinor } }));
      return { refundId: refund.id, amountMinor };
    }),
  );
  await effects.flush();
  return result;
}

/** Re-queues a refund whose provider call has not gone through yet (e.g. a provider outage). */
export async function retryRefund(ctx: AdminContext, refundId: string): Promise<void> {
  const refund = await db.refund.findUnique({ where: { id: refundId }, select: { status: true, providerRefundId: true, orderId: true } });
  if (!refund) throw Errors.notFound("Refund");
  if (refund.status !== "PENDING" || refund.providerRefundId) throw Errors.conflict("not_retryable", "This refund is already with the payment provider.");
  await enqueueRefundExecution(refundId);
  await withTransaction((tx) => writeAudit(tx, ctx, { action: "REFUND", entityType: "Refund", entityId: refundId, reason: "retry requested" }));
}
