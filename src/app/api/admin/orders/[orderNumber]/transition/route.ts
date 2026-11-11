import { json, readIdempotencyKey, readJson, route } from "@/lib/api/handler";
import { orderTransitionSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { transitionOrderStatus } from "@/server/admin/orders.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/orders/:orderNumber/transition { to, note?, tracking?, restock?, refundRemaining? } */
export const POST = route<{ orderNumber: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "orders:manage", requestId);
  const body = await readJson(request, orderTransitionSchema);
  const result = await transitionOrderStatus(ctx, params.orderNumber, body, readIdempotencyKey(request));
  return json(result);
});
