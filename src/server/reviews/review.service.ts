import { Errors } from "@/lib/api/errors";
import { db, isUniqueConstraintError, withTransaction, type TransactionClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { CacheTags, invalidateCacheTags } from "@/lib/redis";
import type { z } from "zod";
import type { reviewSchema } from "@/schemas/account";

/**
 * Reviews from customers who received the product are "Verified purchase" and published
 * immediately; other reviews wait for moderation (status PENDING) before they appear.
 */
export async function createReview(
  userId: string,
  productSlug: string,
  input: z.output<typeof reviewSchema>,
): Promise<{ status: "APPROVED" | "PENDING"; isVerifiedPurchase: boolean }> {
  const product = await db.product.findFirst({ where: { slug: productSlug, status: "ACTIVE", deletedAt: null }, select: { id: true } });
  if (!product) throw Errors.notFound("Product");

  try {
    const result = await withTransaction(async (tx) => {
      const delivered = await tx.orderItem.findFirst({
        where: { productId: product.id, order: { userId, status: "DELIVERED" }, review: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const status = delivered ? ("APPROVED" as const) : ("PENDING" as const);
      await tx.review.create({
        data: {
          productId: product.id,
          userId,
          orderItemId: delivered?.id ?? null,
          rating: input.rating,
          title: input.title,
          body: input.body,
          isVerifiedPurchase: Boolean(delivered),
          status,
        },
      });
      if (status === "APPROVED") {
        await recomputeProductRating(tx, product.id);
      }
      return { status, isVerifiedPurchase: Boolean(delivered) };
    });
    if (result.status === "APPROVED") {
      await invalidateCacheTags([CacheTags.product(product.id), CacheTags.catalog(), CacheTags.home()]).catch((error: unknown) =>
        logger.warn({ err: error }, "cache invalidation after review failed"),
      );
    }
    return result;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw Errors.conflict("already_reviewed", "You have already reviewed this product.");
    }
    throw error;
  }
}

/** Denormalised rating used for sorting and cards; recomputed from approved reviews. */
export async function recomputeProductRating(tx: TransactionClient, productId: string): Promise<void> {
  const aggregate = await tx.review.aggregate({
    where: { productId, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: {
      ratingAverage: Math.round((aggregate._avg.rating ?? 0) * 10) / 10,
      ratingCount: aggregate._count._all,
    },
  });
}
