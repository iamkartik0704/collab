import { z } from "zod";
import { enforceRateLimit, json, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { RateLimitPolicies } from "@/lib/redis";
import { listWishlistProductIds, removeFromWishlist } from "@/server/wishlist/wishlist.service";

export const dynamic = "force-dynamic";

/** DELETE /api/wishlist/:productId */
export const DELETE = route<{ productId: string }>(async (_request, { params }) => {
  const user = await requireUser();
  await enforceRateLimit(RateLimitPolicies.publicApi, `user:${user.id}`);
  const productId = z.string().regex(/^[a-z0-9]{10,40}$/).parse(params.productId);
  await removeFromWishlist(user.id, productId);
  return json({ productIds: await listWishlistProductIds(user.id) });
});
