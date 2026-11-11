import { json, readJson, route } from "@/lib/api/handler";
import { inventorySettingsSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { setLowStockThreshold } from "@/server/admin/inventory.service";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/inventory/:variantId { lowStockThreshold } */
export const PATCH = route<{ variantId: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "inventory:write", requestId);
  const body = await readJson(request, inventorySettingsSchema);
  return json({ threshold: await setLowStockThreshold(ctx, params.variantId, body.lowStockThreshold) });
});
