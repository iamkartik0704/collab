"use client";

import { ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { useCart, useCartMutations } from "@/hooks/use-cart";
import { formatMoney } from "@/lib/utils";
import { MAX_QUANTITY_PER_LINE } from "@/schemas/cart";
import { ProductImage } from "@/components/shared/product-image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { CouponField, TotalsList } from "./order-summary";
import { QuantityStepper } from "./quantity-stepper";

export function CartPageView() {
  const { data: cart, isLoading } = useCart();
  const { setQuantity, removeItem } = useCartMutations();

  if (isLoading) {
    return (
      <div className="container-site grid gap-12 py-14 lg:grid-cols-[1fr_536px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="container-site flex flex-col items-center gap-4 py-28 text-center">
        <ShoppingBag className="size-14 text-line-2" strokeWidth={1.25} />
        <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        <p className="text-muted-2">Find something you love in the catalog.</p>
        <Button asChild size="lg">
          <Link href="/catalog">Continue shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container-site grid gap-12 py-10 lg:grid-cols-[1fr_480px] lg:py-28">
      <section aria-labelledby="cart-title">
        <h1 id="cart-title" className="text-2xl font-semibold">
          Shopping Cart
        </h1>
        <ul className="mt-6 divide-y divide-line-2">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="flex gap-4 py-8">
              <Link href={`/products/${line.productSlug}`} className="relative size-[90px] shrink-0">
                <ProductImage src={line.imageUrl} alt={line.productName} sizes="90px" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 sm:min-w-[180px]">
                  <Link href={`/products/${line.productSlug}`} className="line-clamp-2 font-medium hover:underline">
                    {line.productName}
                  </Link>
                  <p className="mt-1 text-sm text-muted-2">{line.variantTitle}</p>
                  <p className="mt-1 truncate text-xs text-muted" title={line.sku}>
                    #{line.sku}
                  </p>
                  {line.issue && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {line.issue === "unavailable" ? "No longer available — remove it to continue." : `Only ${line.available} in stock — reduce the quantity to continue.`}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-6 sm:justify-end">
                  <QuantityStepper
                    label={line.productName}
                    value={line.quantity}
                    max={Math.min(MAX_QUANTITY_PER_LINE, Math.max(line.available, 1))}
                    disabled={line.issue === "unavailable" || setQuantity.isPending}
                    onChange={(quantity) => setQuantity.mutate({ variantId: line.variantId, quantity })}
                  />
                  <span className="w-28 text-right text-xl font-medium">{formatMoney(line.lineSubtotalMinor, cart.currency)}</span>
                  <button type="button" onClick={() => removeItem.mutate(line.variantId)} className="p-1 text-ink hover:text-danger" aria-label={`Remove ${line.productName}`}>
                    <X className="size-5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside aria-labelledby="summary-title" className="h-fit rounded-[10px] border border-line px-6 py-8 lg:sticky lg:top-40 lg:px-16 lg:py-14">
        <h2 id="summary-title" className="text-xl font-bold">
          Order Summary
        </h2>
        <div className="mt-10 space-y-6">
          <CouponField cart={cart} />
          <TotalsList cart={cart} />
        </div>
        {!cart.isCheckoutReady && (
          <p role="alert" className="mt-6 text-sm text-danger">
            Some items need your attention before checkout.
          </p>
        )}
        {cart.isCheckoutReady ? (
          <Button asChild size="lg" block className="mt-12">
            <Link href="/checkout">Checkout</Link>
          </Button>
        ) : (
          <Button size="lg" block className="mt-12" disabled>
            Checkout
          </Button>
        )}
        <p className="mt-4 text-center text-xs text-muted-2">Shipping is estimated with our default option; choose yours at checkout.</p>
      </aside>
    </div>
  );
}
