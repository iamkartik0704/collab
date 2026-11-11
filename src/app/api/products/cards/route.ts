import { z } from "zod";
import { enforceRateLimit, json, route } from "@/lib/api/handler";
import { RateLimitPolicies } from "@/lib/redis";
import { getClientIp } from "@/lib/security/request";
import { getProductCardsByIds } from "@/server/catalog/catalog.service";

export const dynamic = "force-dynamic";

const idsSchema = z.array(z.string().regex(/^[a-z0-9]{10,40}$/)).max(50);

/** GET /api/products/cards?ids=a,b - card data for the (guest) wishlist page. */
export const GET = route(async (request) => {
  await enforceRateLimit(RateLimitPolicies.publicApi, getClientIp(request.headers));
  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsSchema.parse(raw ? raw.split(",") : []);
  return json({ products: ids.length ? await getProductCardsByIds(ids) : [] });
});
