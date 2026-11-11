import { Errors } from "@/lib/api/errors";
import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { RateLimitPolicies } from "@/lib/redis";
import { applyCouponSchema } from "@/schemas/cart";
import { setCartCoupon } from "@/server/cart/cart.service";
import { rateLimitIdentity } from "@/server/cart/identifier";
import { resolveCartContext } from "@/server/cart/identity";

export const dynamic = "force-dynamic";

/**
 * POST /api/cart/coupon { code } - live validation (15 attempts / min / user or IP, which
 * also throttles code guessing). Invalid codes return 422 with the reason and are not stored.
 */
export const POST = route(async (request) => {
  const body = await readJson(request, applyCouponSchema);
  const context = await resolveCartContext({ create: false });
  await enforceRateLimit(RateLimitPolicies.checkout, rateLimitIdentity(context, request.headers));
  if (!context) throw Errors.unprocessable("cart_empty", "Add something to your cart before applying a coupon.");
  const cart = await setCartCoupon(context.owner, body.code, context.user?.id ?? null);
  return json({ cart });
});

/** DELETE /api/cart/coupon - removes the applied coupon. */
export const DELETE = route(async (request) => {
  const context = await resolveCartContext({ create: false });
  if (!context) throw Errors.notFound("Cart");
  await enforceRateLimit(RateLimitPolicies.publicApi, rateLimitIdentity(context, request.headers));
  const cart = await setCartCoupon(context.owner, null, context.user?.id ?? null);
  return json({ cart });
});
