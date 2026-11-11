import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { RateLimitPolicies } from "@/lib/redis";
import { addCartItemSchema } from "@/schemas/cart";
import { addCartItem, getCartPriced } from "@/server/cart/cart.service";
import { rateLimitIdentity } from "@/server/cart/identifier";
import { resolveCartContext } from "@/server/cart/identity";

export const dynamic = "force-dynamic";

/** POST /api/cart/items { variantId, quantity } - adds to the cart, enforcing live stock. */
export const POST = route(async (request) => {
  const body = await readJson(request, addCartItemSchema);
  const context = (await resolveCartContext({ create: true }))!;
  await enforceRateLimit(RateLimitPolicies.publicApi, rateLimitIdentity(context, request.headers));
  await addCartItem(context.owner, body.variantId, body.quantity);
  return json({ cart: await getCartPriced(context.owner, context.user?.id ?? null) }, { status: 201 });
});
