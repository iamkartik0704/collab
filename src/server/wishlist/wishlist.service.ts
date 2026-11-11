import { Errors } from "@/lib/api/errors";
import { db } from "@/lib/db";

const MAX_WISHLIST = 200;

export async function listWishlistProductIds(userId: string): Promise<string[]> {
  const rows = await db.wishlistItem.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { productId: true } });
  return rows.map((row) => row.productId);
}

export async function addToWishlist(userId: string, productId: string): Promise<void> {
  const product = await db.product.findFirst({ where: { id: productId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
  if (!product) throw Errors.notFound("Product");
  if ((await db.wishlistItem.count({ where: { userId } })) >= MAX_WISHLIST) {
    throw Errors.unprocessable("wishlist_full", `Your wishlist can hold up to ${MAX_WISHLIST} products.`);
  }
  await db.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
}

export async function removeFromWishlist(userId: string, productId: string): Promise<void> {
  await db.wishlistItem.deleteMany({ where: { userId, productId } });
}

/** Merges a guest's locally-saved wishlist into the account after sign-in. */
export async function syncWishlist(userId: string, productIds: readonly string[]): Promise<string[]> {
  const valid = await db.product.findMany({
    where: { id: { in: [...new Set(productIds)].slice(0, MAX_WISHLIST) }, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (valid.length > 0) {
    await db.wishlistItem.createMany({
      data: valid.map(({ id }) => ({ userId, productId: id })),
      skipDuplicates: true,
    });
  }
  return listWishlistProductIds(userId);
}
