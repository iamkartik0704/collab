import { json, readJson, route } from "@/lib/api/handler";
import { couponInputSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { deleteCoupon, saveCoupon } from "@/server/admin/coupons.service";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/coupons/:id */
export const PATCH = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "coupons:manage", requestId);
  const input = await readJson(request, couponInputSchema);
  return json({ coupon: await saveCoupon(ctx, params.id, input) });
});

/** DELETE /api/admin/coupons/:id - deletes unused coupons, disables used ones. */
export const DELETE = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "coupons:manage", requestId);
  return json(await deleteCoupon(ctx, params.id));
});
