import { z } from "zod";
import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { getOptionalUser, requireUser } from "@/lib/auth/session";
import { RateLimitPolicies } from "@/lib/redis";
import { addToWishlist, listWishlistProductIds } from "@/server/wishlist/wishlist.service";

export const dynamic = "force-dynamic";

const productIdSchema = z.string().regex(/^[a-z0-9]{10,40}$/);

/** GET /api/wishlist - product ids for the signed-in user (guests keep theirs locally). */
export const GET = route(async () => {
  const user = await getOptionalUser();
  return json({ productIds: user ? await listWishlistProductIds(user.id) : [], signedIn: Boolean(user) });
});

/** POST /api/wishlist { productId } */
export const POST = route(async (request) => {
  const user = await requireUser();
  await enforceRateLimit(RateLimitPolicies.publicApi, `user:${user.id}`);
  const { productId } = await readJson(request, z.object({ productId: productIdSchema }));
  await addToWishlist(user.id, productId);
  return json({ productIds: await listWishlistProductIds(user.id) }, { status: 201 });
});
