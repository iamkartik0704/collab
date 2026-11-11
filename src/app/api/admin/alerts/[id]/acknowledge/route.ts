import { json, route } from "@/lib/api/handler";
import { requireAdmin } from "@/server/admin/context";
import { acknowledgeAlert } from "@/server/admin/inventory.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/alerts/:id/acknowledge */
export const POST = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "admin:access", requestId);
  await acknowledgeAlert(ctx, params.id);
  return json({ acknowledged: true });
});
