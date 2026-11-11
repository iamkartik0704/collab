import { json, readJson, route } from "@/lib/api/handler";
import { productInputSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { saveProduct } from "@/server/admin/products.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/products - creates a product with its variant matrix, stock and images. */
export const POST = route(async (request, { requestId }) => {
  const ctx = await requireAdmin(request, "catalog:write", requestId);
  const input = await readJson(request, productInputSchema, { maxBytes: 512 * 1024 });
  const product = await saveProduct(ctx, null, input);
  return json({ product }, { status: 201 });
});
