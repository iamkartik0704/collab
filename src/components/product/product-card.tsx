"use client";

import Link from "next/link";
import { discountPercent, formatMoney } from "@/lib/utils";
import type { ProductCardData } from "@/types/catalog";
import { ProductImage } from "@/components/shared/product-image";
import { Button } from "@/components/ui/button";
import { useAddToCart } from "./add-to-cart";
import { WishlistButton } from "./wishlist-button";

/**
 * Figma product card: #F6F6F6, 9px radius, 24px padding, wishlist heart top-right,
 * 160x160 artwork, 2-line title, bold price, full-width black "Buy Now".
 */
export function ProductCard({ product, priority = false, showDiscount = false }: { product: ProductCardData; priority?: boolean; showDiscount?: boolean }) {
  const { add, pending, error } = useAddToCart();
  const discount = discountPercent(product.priceMinor, product.compareAtPriceMinor);

  return (
    <article className="group relative flex h-full flex-col items-center rounded-[var(--radius-card)] bg-surface px-3 py-6 text-center sm:px-4">
      <WishlistButton productId={product.id} productName={product.name} className="absolute right-3 top-3 z-10 sm:right-4 sm:top-4" />
      {showDiscount && discount > 0 && (
        <span className="absolute left-3 top-4 rounded bg-ink px-2 py-0.5 text-xs font-semibold text-white sm:left-4">−{discount}%</span>
      )}
      <Link href={`/products/${product.slug}`} className="flex w-full flex-1 flex-col items-center">
        <div className="relative mt-4 size-[104px] transition-transform duration-300 group-hover:scale-105 sm:size-40">
          <ProductImage src={product.imageUrl} alt={product.name} sizes="160px" priority={priority} />
        </div>
        <h3 className="mt-4 line-clamp-2 min-h-12 text-sm font-medium leading-6 sm:text-base">{product.name}</h3>
        <p className="mt-4 flex flex-wrap items-baseline justify-center gap-x-2">
          <span className="text-xl font-semibold sm:text-2xl">{formatMoney(product.priceMinor, product.currency)}</span>
          {showDiscount && product.compareAtPriceMinor && product.compareAtPriceMinor > product.priceMinor && (
            <span className="text-sm text-muted line-through">{formatMoney(product.compareAtPriceMinor, product.currency)}</span>
          )}
        </p>
      </Link>
      <Button
        className="mt-4 w-full sm:w-auto sm:min-w-[184px]"
        loading={pending}
        disabled={!product.inStock}
        onClick={() => add(product.defaultVariantId)}
        aria-label={product.inStock ? `Buy ${product.name} now` : `${product.name} is out of stock`}
      >
        {product.inStock ? "Buy Now" : "Out of stock"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

export function ProductGrid({ products, columns = 4, showDiscount = false }: { products: ProductCardData[]; columns?: 3 | 4; showDiscount?: boolean }) {
  return (
    <ul className={columns === 4 ? "grid grid-cols-2 gap-4 lg:grid-cols-4" : "grid grid-cols-2 gap-4 lg:grid-cols-3"}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < 4} showDiscount={showDiscount} />
        </li>
      ))}
    </ul>
  );
}
