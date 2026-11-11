import { json, readJson, route } from "@/lib/api/handler";
import { presignImageUpload } from "@/lib/storage/s3";
import { presignRequestSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { PRODUCT_UPLOAD_PREFIX } from "@/server/admin/products.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/uploads/presign { contentType, sizeBytes, productId? }
 * Returns a presigned POST policy for one product image (exact key, type and size pinned).
 */
export const POST = route(async (request, { requestId }) => {
  const ctx = await requireAdmin(request, "catalog:write", requestId);
  const body = await readJson(request, presignRequestSchema);
  const folder = body.productId ? body.productId.replace(/[^a-z0-9]/gi, "") : `staging/${ctx.actor.id}`;
  const upload = await presignImageUpload({ prefix: `${PRODUCT_UPLOAD_PREFIX}${folder}`, contentType: body.contentType, sizeBytes: body.sizeBytes });
  return json({ upload }, { status: 201 });
});
