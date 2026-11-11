import { z } from "zod";
import { Errors } from "@/lib/api/errors";
import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { RateLimitPolicies } from "@/lib/redis";
import { getClientIp } from "@/lib/security/request";
import { reviewSchema } from "@/schemas/account";
import { getReviews } from "@/server/catalog/catalog.service";
import { createReview } from "@/server/reviews/review.service";

export const dynamic = "force-dynamic";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,160}$/);

/** GET /api/products/:slug/reviews?page=2 - approved reviews, verified purchases first. */
export const GET = route<{ slug: string }>(async (request, { params }) => {
  await enforceRateLimit(RateLimitPolicies.publicApi, getClientIp(request.headers));
  const slug = slugSchema.parse(params.slug);
  const product = await db.product.findFirst({ where: { slug, status: "ACTIVE", deletedAt: null }, select: { id: true } });
  if (!product) throw Errors.notFound("Product");
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  return json(await getReviews(product.id, Number.isInteger(page) && page > 0 ? page : 1));
});

/** POST /api/products/:slug/reviews { rating, title, body } - signed-in customers, one per product. */
export const POST = route<{ slug: string }>(async (request, { params }) => {
  const user = await requireUser();
  await enforceRateLimit(RateLimitPolicies.checkout, `review:${user.id}`);
  const slug = slugSchema.parse(params.slug);
  const body = await readJson(request, reviewSchema);
  const result = await createReview(user.id, slug, body);
  return json(result, { status: 201 });
});
