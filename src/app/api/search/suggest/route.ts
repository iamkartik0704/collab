import { enforceRateLimit, json, route } from "@/lib/api/handler";
import { RateLimitPolicies } from "@/lib/redis";
import { getClientIp } from "@/lib/security/request";
import { getSearchSuggestions } from "@/server/catalog/catalog.service";

export const dynamic = "force-dynamic";

/** GET /api/search/suggest?q=iph - header autocomplete (products + categories). */
export const GET = route(async (request) => {
  await enforceRateLimit(RateLimitPolicies.publicApi, getClientIp(request.headers));
  const q = request.nextUrl.searchParams.get("q") ?? "";
  return json(await getSearchSuggestions(q), { headers: { "Cache-Control": "private, max-age=30" } });
});
