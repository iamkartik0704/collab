"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCart, useCartMutations } from "@/hooks/use-cart";
import { MAX_QUANTITY_PER_LINE } from "@/schemas/cart";
import { formatMoney } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { ProductImage } from "@/components/shared/product-image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { QuantityStepper } from "./quantity-stepper";

export function CartDrawer() {
  const open = useUiStore((state) => state.cartOpen);
  const setOpen = useUiStore((state) => state.setCartOpen);
  const { data: cart, isLoading } = useCart();
  const { setQuantity, removeItem } = useCartMutations();
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent title={`Shopping Cart${cart?.itemCount ? ` (${cart.itemCount})` : ""}`}>
        <div className="flex-1 overflow-y-auto px-6">
          {isLoading ? (
            <div className="space-y-4 py-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !cart || cart.lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <ShoppingBag className="size-12 text-line-2" strokeWidth={1.25} />
              <p className="text-lg font-medium">Your cart is empty</p>
              <p className="text-sm text-muted-2">Browse the catalog and add something you love.</p>
              <Button asChild variant="outline" onClick={close}>
                <Link href="/catalog">Start shopping</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {cart.lines.map((line) => (
                  <motion.li
                    key={line.variantId}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ duration: 0.18 }}
                    className="flex gap-4 py-5"
                  >
                    <Link href={`/products/${line.productSlug}`} onClick={close} className="relative size-20 shrink-0 rounded-md bg-surface">
                      <ProductImage src={line.imageUrl} alt={line.productName} sizes="80px" className="p-2" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/products/${line.productSlug}`} onClick={close} className="line-clamp-2 text-sm font-medium hover:underline">
                          {line.productName}
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeItem.mutate(line.variantId)}
                          className="shrink-0 p-1 text-muted transition-colors hover:text-ink"
                          aria-label={`Remove ${line.productName}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-2">{line.variantTitle}</p>
                      {line.issue && (
                        <p className="mt-1 text-xs text-danger">{line.issue === "unavailable" ? "No longer available" : `Only ${line.available} left`}</p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <QuantityStepper
                          label={line.productName}
                          value={line.quantity}
                          max={Math.min(MAX_QUANTITY_PER_LINE, line.available)}
                          disabled={line.issue === "unavailable"}
                          onChange={(quantity) => setQuantity.mutate({ variantId: line.variantId, quantity })}
                        />
                        <span className="text-base font-semibold">{formatMoney(line.lineSubtotalMinor, cart.currency)}</span>
                      </div>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {cart && cart.lines.length > 0 && (
          <div className="space-y-4 border-t border-line px-6 py-5">
            <div className="flex items-center justify-between text-base">
              <span className="font-medium">Subtotal</span>
              <span className="font-semibold">{formatMoney(cart.subtotalMinor - cart.discountMinor, cart.currency)}</span>
            </div>
            <p className="text-xs text-muted-2">GST included. Shipping and coupons are calculated at checkout.</p>
            <div className="grid grid-cols-2 gap-3">
              <Button asChild variant="outline" onClick={close}>
                <Link href="/cart">View cart</Link>
              </Button>
              <Button asChild onClick={close}>
                <Link href="/checkout">Checkout</Link>
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
