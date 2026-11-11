"use client";

import { Tag, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useCartMutations, type CartView } from "@/hooks/use-cart";
import { ApiClientError } from "@/lib/api-client";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SummaryRow({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={strong ? "flex justify-between text-base font-semibold" : "flex justify-between text-base"}>
      <dt className={muted ? "text-muted-2" : "font-medium"}>{label}</dt>
      <dd className={strong ? "" : "font-medium"}>{value}</dd>
    </div>
  );
}

/** Coupon code entry with live server validation (rejections explain why). */
export function CouponField({ cart }: { cart: CartView }) {
  const { applyCoupon, removeCoupon } = useCartMutations();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const applied = cart.coupon?.applied ? cart.coupon : null;

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-[7px] border border-success/40 bg-success/5 px-4 py-3">
        <span className="flex items-center gap-2 text-sm">
          <Tag className="size-4 text-success" aria-hidden />
          <span className="font-semibold">{applied.code}</span>
          <span className="text-muted-2">−{formatMoney(applied.discountMinor, cart.currency)}</span>
        </span>
        <button type="button" onClick={() => removeCoupon.mutate()} className="rounded p-1 hover:bg-white" aria-label={`Remove coupon ${applied.code}`}>
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!code.trim()) return;
        setError(null);
        applyCoupon.mutate(code.trim(), {
          onSuccess: () => setCode(""),
          onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Could not apply that code."),
        });
      }}
    >
      <label htmlFor="coupon" className="mb-2 block text-sm text-muted-2">
        Discount code / Promo code
      </label>
      <div className="flex gap-2">
        <Input
          id="coupon"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="Code"
          invalid={Boolean(error)}
          aria-describedby={error ? "coupon-error" : undefined}
          autoComplete="off"
        />
        <Button type="submit" variant="outline" loading={applyCoupon.isPending} className="shrink-0">
          Apply
        </Button>
      </div>
      {error && (
        <p id="coupon-error" role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
      {cart.coupon && !cart.coupon.applied && <p className="mt-1 text-xs text-danger">{cart.coupon.message}</p>}
    </form>
  );
}

export function TotalsList({ cart }: { cart: CartView }) {
  return (
    <dl className="space-y-4">
      <SummaryRow label="Subtotal" value={formatMoney(cart.subtotalMinor, cart.currency)} />
      {cart.discountMinor > 0 && <SummaryRow label="Discount" value={`−${formatMoney(cart.discountMinor, cart.currency)}`} muted />}
      <SummaryRow label="GST (included)" value={formatMoney(cart.taxMinor, cart.currency)} muted />
      <SummaryRow
        label={cart.shipping ? `Shipping · ${cart.shipping.name}` : "Shipping"}
        value={cart.shippingMinor === 0 ? "Free" : formatMoney(cart.shippingMinor, cart.currency)}
        muted
      />
      <div className="border-t border-line pt-4">
        <SummaryRow label="Total" value={formatMoney(cart.totalMinor, cart.currency)} strong />
      </div>
    </dl>
  );
}
