import { json, readJson, route } from "@/lib/api/handler";
import { couponInputSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/context";
import { saveCoupon } from "@/server/admin/coupons.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/coupons */
export const POST = route(async (request, { requestId }) => {
  const ctx = await requireAdmin(request, "coupons:manage", requestId);
  const input = await readJson(request, couponInputSchema);
  return json({ coupon: await saveCoupon(ctx, null, input) }, { status: 201 });
});
