import { z } from "zod";
import { Errors } from "@/lib/api/errors";
import { json, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/:orderNumber - the confirmation page polls this until the payment webhook
 * has moved the order out of PENDING_PAYMENT. Owner only (404 for anyone else).
 */
export const GET = route<{ orderNumber: string }>(async (_request, { params }) => {
  const user = await requireUser();
  const orderNumber = z.string().regex(/^CLB-[0-9A-Z]{8,20}$/).parse(params.orderNumber);
  const order = await db.order.findFirst({
    where: { orderNumber, userId: user.id },
    select: {
      orderNumber: true,
      status: true,
      currency: true,
      totalMinor: true,
      cancelReason: true,
      estimatedDeliveryAt: true,
      shippingMethodName: true,
      createdAt: true,
      items: { select: { productName: true, variantTitle: true, quantity: true, lineTotalMinor: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, failureMessage: true } },
    },
  });
  if (!order) throw Errors.notFound("Order");
  return json({ order: { ...order, payment: order.payments[0] ?? null, payments: undefined } });
});
