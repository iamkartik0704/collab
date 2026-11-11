"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCart } from "@/hooks/use-cart";
import { formatMoney } from "@/lib/utils";
import type { SavedAddress } from "@/schemas/account";
import { ProductImage } from "@/components/shared/product-image";
import { TotalsList } from "@/components/cart/order-summary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { AddressStep, useAddresses } from "./address-step";
import { CheckoutStepper } from "./checkout-stepper";
import { PaymentStep } from "./payment-step";
import { ShippingStep, type ScheduleValue, type ShippingMethodView } from "./shipping-step";

export function CheckoutFlow({ initialAddresses, shippingMethods, customerName }: { initialAddresses: SavedAddress[]; shippingMethods: ShippingMethodView[]; customerName: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const { data: addresses } = useAddresses(initialAddresses);
  const [addressId, setAddressId] = useState<string | null>(() => initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null);
  const [shippingCode, setShippingCode] = useState<string | null>(shippingMethods[0]?.code ?? null);
  const [schedule, setSchedule] = useState<ScheduleValue>({ date: "", slot: "" });
  const { data: cart, isLoading } = useCart(step >= 2 ? shippingCode : null);

  const method = shippingMethods.find((m) => m.code === shippingCode) ?? null;
  const address = addresses.find((a) => a.id === addressId) ?? null;
  const scheduleComplete = !method?.requiresSlot || (schedule.date !== "" && schedule.slot !== "");

  const request = useMemo(
    () => ({
      addressId: addressId ?? "",
      shippingMethodCode: shippingCode ?? "",
      ...(method?.requiresSlot && schedule.date && schedule.slot ? { scheduledDate: schedule.date, scheduledSlot: schedule.slot } : {}),
    }),
    [addressId, shippingCode, method?.requiresSlot, schedule.date, schedule.slot],
  );

  if (isLoading) {
    return (
      <div className="container-site py-16">
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="container-site flex flex-col items-center gap-4 py-28 text-center">
        <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        <Button asChild size="lg">
          <Link href="/catalog">Continue shopping</Link>
        </Button>
      </div>
    );
  }

  if (!cart.isCheckoutReady) {
    return (
      <div className="container-site flex flex-col items-center gap-4 py-28 text-center">
        <h1 className="text-2xl font-semibold">Some items need your attention</h1>
        <p className="text-muted-2">An item in your cart is unavailable or short on stock.</p>
        <Button asChild size="lg">
          <Link href="/cart">Review cart</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container-site pb-24">
      <h1 className="sr-only">Checkout</h1>
      <CheckoutStepper current={step} />

      {step === 1 && (
        <>
          <AddressStep initial={initialAddresses} selectedId={addressId} onSelect={setAddressId} />
          <StepActions backHref="/cart" onNext={() => setStep(2)} nextDisabled={!address} hint={!address ? "Add or select an address to continue." : undefined} />
        </>
      )}

      {step === 2 && (
        <>
          <ShippingStep
            methods={shippingMethods}
            goodsTotalMinor={cart.subtotalMinor - cart.discountMinor}
            currency={cart.currency}
            selected={shippingCode}
            onSelect={setShippingCode}
            schedule={schedule}
            onScheduleChange={setSchedule}
          />
          <StepActions onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={!method || !scheduleComplete} hint={!scheduleComplete ? "Pick a delivery date and slot." : undefined} />
        </>
      )}

      {step === 3 && address && method && (
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <section aria-labelledby="summary-heading" className="h-fit rounded-[10px] border border-line px-6 py-8 lg:px-8">
            <h2 id="summary-heading" className="text-xl font-medium">
              Summary
            </h2>
            <ul className="mt-6 space-y-4">
              {cart.lines.map((line) => (
                <li key={line.variantId} className="flex items-center gap-4 rounded-[13px] bg-surface p-4">
                  <span className="relative size-10 shrink-0">
                    <ProductImage src={line.imageUrl} alt="" sizes="40px" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {line.productName} {line.quantity > 1 && <span className="text-muted-2">× {line.quantity}</span>}
                  </span>
                  <span className="font-semibold">{formatMoney(line.lineTotalMinor, cart.currency)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-8 space-y-4 text-sm">
              <div>
                <dt className="text-muted-2">Address</dt>
                <dd className="mt-1">
                  {address.fullName}, {address.line1}, {address.city}, {address.state} {address.postalCode}
                </dd>
              </div>
              <div>
                <dt className="text-muted-2">Shipment method</dt>
                <dd className="mt-1">
                  {method.name}
                  {method.requiresSlot && schedule.date ? ` · ${schedule.date}, ${schedule.slot}` : ` · arrives in ${method.minDays}-${method.maxDays} days`}
                </dd>
              </div>
            </dl>
            <div className="mt-8">
              <TotalsList cart={cart} />
            </div>
          </section>
          <PaymentStep request={request} totalMinor={cart.totalMinor} currency={cart.currency} customerName={address.fullName || customerName} onBack={() => setStep(2)} />
        </div>
      )}
    </div>
  );
}

function StepActions({ onBack, backHref, onNext, nextDisabled, hint }: { onBack?: () => void; backHref?: string; onNext: () => void; nextDisabled: boolean; hint?: string | undefined }) {
  return (
    <div className="mt-16 flex flex-col items-stretch gap-3 sm:items-end">
      {hint && <p className="text-sm text-muted-2">{hint}</p>}
      <div className="flex gap-4">
        {backHref ? (
          <Button asChild variant="outline" size="lg" className="flex-1 sm:w-52 sm:flex-none">
            <Link href={backHref}>Back</Link>
          </Button>
        ) : (
          <Button variant="outline" size="lg" className="flex-1 sm:w-52 sm:flex-none" onClick={onBack}>
            Back
          </Button>
        )}
        <Button size="lg" className="flex-1 sm:w-52 sm:flex-none" disabled={nextDisabled} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
