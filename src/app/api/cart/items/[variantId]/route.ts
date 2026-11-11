import { Errors } from "@/lib/api/errors";
import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { RateLimitPolicies } from "@/lib/redis";
import { updateCartItemSchema, variantIdSchema } from "@/schemas/cart";
import { getCartPriced, removeCartItem, setCartItemQuantity } from "@/server/cart/cart.service";
import { rateLimitIdentity } from "@/server/cart/identifier";
import { resolveCartContext } from "@/server/cart/identity";

export const dynamic = "force-dynamic";

/** PATCH /api/cart/items/:variantId { quantity } - the -/+ stepper (0 removes the line). */
export const PATCH = route<{ variantId: string }>(async (request, { params }) => {
  const variantId = variantIdSchema.parse(params.variantId);
  const body = await readJson(request, updateCartItemSchema);
  const context = await resolveCartContext({ create: false });
  if (!context) throw Errors.notFound("Cart item");
  await enforceRateLimit(RateLimitPolicies.publicApi, rateLimitIdentity(context, request.headers));
  await setCartItemQuantity(context.owner, variantId, body.quantity);
  return json({ cart: await getCartPriced(context.owner, context.user?.id ?? null) });
});

/** DELETE /api/cart/items/:variantId */
export const DELETE = route<{ variantId: string }>(async (request, { params }) => {
  const variantId = variantIdSchema.parse(params.variantId);
  const context = await resolveCartContext({ create: false });
  if (!context) throw Errors.notFound("Cart item");
  await enforceRateLimit(RateLimitPolicies.publicApi, rateLimitIdentity(context, request.headers));
  await removeCartItem(context.owner, variantId);
  return json({ cart: await getCartPriced(context.owner, context.user?.id ?? null) });
});
