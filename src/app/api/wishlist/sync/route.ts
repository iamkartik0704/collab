import { z } from "zod";
import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { RateLimitPolicies } from "@/lib/redis";
import { syncWishlist } from "@/server/wishlist/wishlist.service";

export const dynamic = "force-dynamic";

/** POST /api/wishlist/sync { productIds } - merges the guest wishlist after sign-in. */
export const POST = route(async (request) => {
  const user = await requireUser();
  await enforceRateLimit(RateLimitPolicies.publicApi, `user:${user.id}`);
  const { productIds } = await readJson(request, z.object({ productIds: z.array(z.string().regex(/^[a-z0-9]{10,40}$/)).max(200) }));
  return json({ productIds: await syncWishlist(user.id, productIds) });
});
