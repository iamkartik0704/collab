import { json, readJson, route } from "@/lib/api/handler";
import { trackingSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { updateTracking } from "@/server/admin/orders.service";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/orders/:orderNumber/tracking { carrierName, trackingNumber, trackingUrl? } */
export const PATCH = route<{ orderNumber: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "orders:manage", requestId);
  await updateTracking(ctx, params.orderNumber, await readJson(request, trackingSchema));
  return json({ updated: true });
});
