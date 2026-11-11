import { enforceRateLimit, json, route } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { RateLimitPolicies } from "@/lib/redis";
import { rateLimitIdentity } from "@/server/cart/identifier";
import { resolveCartContext } from "@/server/cart/identity";
import { priceCart } from "@/server/cart/pricing";

export const dynamic = "force-dynamic";

/**
 * GET /api/cart[?shipping=EXPRESS_PRIORITY] - the cart priced entirely on the server
 * (items, coupon, GST, shipping, total). `shipping` prices a specific delivery option.
 */
export const GET = route(async (request) => {
  const context = await resolveCartContext({ create: false });
  await enforceRateLimit(RateLimitPolicies.publicApi, rateLimitIdentity(context, request.headers));
  const shipping = request.nextUrl.searchParams.get("shipping");
  const shippingMethodCode = shipping && /^[A-Z0-9_]{2,40}$/.test(shipping) ? shipping : null;

  const cart = context
    ? await db.cart.findUnique({
        where: context.owner.kind === "user" ? { userId: context.owner.userId } : { guestToken: context.owner.guestToken },
        select: { couponCode: true, items: { orderBy: { createdAt: "asc" }, select: { variantId: true, quantity: true } } },
      })
    : null;
  const cartView = await priceCart({
    lines: cart?.items ?? [],
    couponCode: cart?.couponCode ?? null,
    userId: context?.user?.id ?? null,
    shippingMethodCode,
  });
  return json({ cart: cartView });
});
