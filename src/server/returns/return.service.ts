import type { ReturnStatus, ReturnType } from "@prisma/client";
import { z } from "zod";
import { RETURN_REASONS, returnRequestInputSchema, type ReturnRequestInput } from "@/schemas/returns";
import { Errors } from "@/lib/api/errors";
import { randomBase32 } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { writeAudit } from "@/server/admin/audit";
import type { AdminContext } from "@/server/admin/context";

/**
 * Customer returns / warranty requests (RMA). Customers raise them from a delivered order; staff
 * approve or reject them on the admin order page. Approval does not move money or stock by
 * itself: once the item is back, staff use the existing refund (with restock) or replacement
 * flow, which keeps refunds behind the refunds:issue permission.
 */

export { RETURN_REASONS, returnRequestInputSchema, type ReturnRequestInput } from "@/schemas/returns";

export const RETURN_WINDOW_DAYS = 7;
export const OPEN_RETURN_STATUSES: ReturnStatus[] = ["REQUESTED", "APPROVED", "PICKUP_SCHEDULED", "RECEIVED"];

const DAY_MS = 86_400_000;

export interface ItemEligibility {
  orderItemId: string;
  returnableQuantity: number;
  canReturn: boolean;
  canWarranty: boolean;
  returnWindowEndsAt: string | null;
  warrantyEndsAt: string | null;
}

/** What each item of a delivered order may still be returned / claimed for. */
export async function returnEligibility(orderId: string): Promise<ItemEligibility[]> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      deliveredAt: true,
      items: { select: { id: true, quantity: true, refundedQuantity: true, product: { select: { warrantyMonths: true } } } },
      returnRequests: { where: { status: { in: OPEN_RETURN_STATUSES } }, select: { orderItemId: true, quantity: true } },
    },
  });
  if (!order) return [];
  const now = Date.now();
  return order.items.map((item) => {
    const delivered = order.status === "DELIVERED" && order.deliveredAt;
    const pending = order.returnRequests.filter((request) => request.orderItemId === item.id).reduce((sum, request) => sum + request.quantity, 0);
    const returnableQuantity = Math.max(0, item.quantity - item.refundedQuantity - pending);
    const returnEnds = delivered ? order.deliveredAt!.getTime() + RETURN_WINDOW_DAYS * DAY_MS : null;
    const warrantyEnds = delivered && item.product.warrantyMonths > 0 ? addMonths(order.deliveredAt!, item.product.warrantyMonths).getTime() : null;
    return {
      orderItemId: item.id,
      returnableQuantity,
      canReturn: Boolean(returnEnds && now <= returnEnds && returnableQuantity > 0),
      canWarranty: Boolean(warrantyEnds && now <= warrantyEnds && returnableQuantity > 0),
      returnWindowEndsAt: returnEnds ? new Date(returnEnds).toISOString() : null,
      warrantyEndsAt: warrantyEnds ? new Date(warrantyEnds).toISOString() : null,
    };
  });
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export async function createReturnRequest(userId: string, orderNumber: string, raw: ReturnRequestInput): Promise<{ rmaNumber: string }> {
  const input = returnRequestInputSchema.parse(raw);
  const order = await db.order.findUnique({ where: { orderNumber }, select: { id: true, userId: true } });
  // Same 404 whether the order is missing or someone else's.
  if (!order || order.userId !== userId) throw Errors.notFound("Order");

  return withTransaction(async (tx) => {
    // Serialise concurrent requests for the same order.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const eligibility = (await returnEligibility(order.id)).find((entry) => entry.orderItemId === input.orderItemId);
    if (!eligibility) throw Errors.unprocessable("invalid_item", "That item is not part of this order.");
    const allowed = input.type === "WARRANTY_REPAIR" ? eligibility.canWarranty : eligibility.canReturn;
    if (!allowed) {
      throw Errors.unprocessable(
        "not_eligible",
        input.type === "WARRANTY_REPAIR"
          ? "This item is not covered by warranty any more, or a request for it is already open."
          : `Returns and replacements are accepted within ${RETURN_WINDOW_DAYS} days of delivery. For a fault after that, raise a warranty request.`,
      );
    }
    if (input.quantity > eligibility.returnableQuantity) {
      throw Errors.unprocessable("quantity_exceeded", `At most ${eligibility.returnableQuantity} unit(s) can be included.`);
    }
    const rmaNumber = `RMA-${randomBase32(8)}`;
    await tx.returnRequest.create({
      data: {
        rmaNumber,
        orderId: order.id,
        orderItemId: input.orderItemId,
        userId,
        type: input.type as ReturnType,
        quantity: input.quantity,
        reason: RETURN_REASONS[input.reason],
        description: input.description || null,
      },
    });
    await tx.adminAlert.create({
      data: {
        type: "SUPPORT_ESCALATION",
        severity: "INFO",
        title: `${rmaNumber}: ${input.type === "WARRANTY_REPAIR" ? "warranty" : input.type.toLowerCase()} request on ${orderNumber}`,
        message: `${RETURN_REASONS[input.reason]}${input.description ? ` - ${input.description.slice(0, 300)}` : ""}`,
        entityType: "Order",
        entityId: order.id,
        dedupeKey: `rma:${rmaNumber}`,
      },
    });
    return { rmaNumber };
  });
}

export const returnDecisionSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional().default("") })
  .refine((input) => input.decision === "APPROVED" || input.note.length >= 5, { path: ["note"], message: "Explain why the request is rejected (shown to the customer)." });

export async function decideReturnRequest(ctx: AdminContext, returnId: string, raw: z.input<typeof returnDecisionSchema>): Promise<void> {
  const input = returnDecisionSchema.parse(raw);
  await withTransaction(async (tx) => {
    const request = await tx.returnRequest.findUnique({ where: { id: returnId }, select: { id: true, status: true, rmaNumber: true, orderId: true } });
    if (!request) throw Errors.notFound("Return request");
    if (request.status !== "REQUESTED") throw Errors.conflict("already_decided", "This request has already been decided.");
    await tx.returnRequest.update({ where: { id: returnId }, data: { status: input.decision, resolutionNote: input.note || null } });
    await tx.adminAlert.updateMany({ where: { dedupeKey: `rma:${request.rmaNumber}`, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedById: ctx.actor.id } });
    await writeAudit(tx, ctx, {
      action: "UPDATE",
      entityType: "ReturnRequest",
      entityId: returnId,
      before: { status: request.status },
      after: { status: input.decision, rmaNumber: request.rmaNumber },
      reason: input.note || null,
    });
  });
}
