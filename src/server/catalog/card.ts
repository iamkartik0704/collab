import type { Prisma } from "@prisma/client";
import { resolveImageUrl } from "@/lib/images";
import type { ProductCardData } from "@/types/catalog";

/** Prisma selection that carries everything a product card needs. */
export const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  ratingAverage: true,
  ratingCount: true,
  images: { where: { isPrimary: true }, take: 1, select: { storageKey: true } },
  variants: {
    where: { isActive: true, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { priceMinor: "asc" }],
    select: {
      id: true,
      priceMinor: true,
      compareAtPriceMinor: true,
      currency: true,
      isDefault: true,
      storageGb: true,
      ramGb: true,
      inventory: { select: { quantityAvailable: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { storageKey: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type CardSource = Prisma.ProductGetPayload<{ select: typeof CARD_SELECT }>;

/**
 * Card price = the default variant ("from" price is the cheapest when no default is set).
 * In stock when any active variant has available units.
 */
export function toProductCard(product: CardSource): ProductCardData | null {
  const primary = product.variants[0];
  if (!primary) return null;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    imageUrl: resolveImageUrl(product.images[0]?.storageKey ?? primary.images[0]?.storageKey),
    priceMinor: primary.priceMinor,
    compareAtPriceMinor: primary.compareAtPriceMinor,
    currency: primary.currency,
    defaultVariantId: primary.id,
    inStock: product.variants.some((variant) => (variant.inventory?.quantityAvailable ?? 0) > 0),
    ratingAverage: product.ratingAverage,
    ratingCount: product.ratingCount,
  };
}
