import { json, readJson, route } from "@/lib/api/handler";
import { stockAdjustmentSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { applyStockAdjustment } from "@/server/admin/inventory.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/inventory/:variantId/adjust { mode, quantity, reason, note?, expectedVersion? } */
export const POST = route<{ variantId: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "inventory:write", requestId);
  const body = await readJson(request, stockAdjustmentSchema);
  return json({ inventory: await applyStockAdjustment(ctx, params.variantId, body) });
});
