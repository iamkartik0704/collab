import { json, readIdempotencyKey, readJson, route } from "@/lib/api/handler";
import { refundRequestSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { createRefund } from "@/server/admin/orders.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:orderNumber/refunds { mode: "items" | "amount", items?, amountMinor?, restock, reason }
 * Idempotent per Idempotency-Key: a retried click returns the refund already created.
 */
export const POST = route<{ orderNumber: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "refunds:issue", requestId);
  const body = await readJson(request, refundRequestSchema);
  const refund = await createRefund(ctx, params.orderNumber, body, readIdempotencyKey(request));
  return json({ refund }, { status: 201 });
});
