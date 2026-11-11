import { json, readJson, route } from "@/lib/api/handler";
import { productInputSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { archiveProduct, saveProduct } from "@/server/admin/products.service";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/products/:id - full update (the form always sends the whole product). */
export const PATCH = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "catalog:write", requestId);
  const input = await readJson(request, productInputSchema, { maxBytes: 512 * 1024 });
  const product = await saveProduct(ctx, params.id, input);
  return json({ product });
});

/** DELETE /api/admin/products/:id - archives (products are never hard-deleted). */
export const DELETE = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "catalog:write", requestId);
  await archiveProduct(ctx, params.id);
  return json({ archived: true });
});
