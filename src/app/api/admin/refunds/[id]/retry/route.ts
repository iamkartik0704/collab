import { json, route } from "@/lib/api/handler";
import { requireAdmin } from "@/server/admin/context";
import { retryRefund } from "@/server/admin/orders.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/refunds/:id/retry - re-queues a refund that has not reached the provider. */
export const POST = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "refunds:issue", requestId);
  await retryRefund(ctx, params.id);
  return json({ queued: true });
});
