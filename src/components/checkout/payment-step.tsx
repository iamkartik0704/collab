"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Clock, Lock, Wifi } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiFetch, newIdempotencyKey } from "@/lib/api-client";
import { isValidGstin, normalizeGstin } from "@/lib/gstin";
import { cn, formatMoney } from "@/lib/utils";
import type { CheckoutBody } from "@/schemas/checkout";
import type { CheckoutResponse } from "@/server/orders/checkout.service";
import { Button } from "@/components/ui/button";
import { openRazorpay } from "./razorpay";

export type PaymentMethodChoice = "CARD" | "UPI" | "NETBANKING" | "WALLET";

const METHODS: Array<{ value: PaymentMethodChoice; label: string; provider: "STRIPE" | "RAZORPAY" }> = [
  { value: "CARD", label: "Credit / Debit Card", provider: "STRIPE" },
  { value: "UPI", label: "UPI", provider: "RAZORPAY" },
  { value: "NETBANKING", label: "NetBanking", provider: "RAZORPAY" },
  { value: "WALLET", label: "Wallet", provider: "RAZORPAY" },
];

const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string) {
  let promise = stripeCache.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    stripeCache.set(publishableKey, promise);
  }
  return promise;
}

function useCountdown(deadline: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  const remaining = Math.max(0, new Date(deadline).getTime() - now);
  return `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
}

/**
 * Step 3. "Pay Now" creates the order (stock reserved for 15 minutes) with an Idempotency-Key
 * that stays the same for an unchanged request, so double-clicks and retries never create a
 * second order. Then: cards -> Stripe Payment Element; UPI / NetBanking / Wallet -> Razorpay.
 * The order is confirmed only by the verified provider webhook (see /checkout/complete).
 */
export function PaymentStep({
  request,
  totalMinor,
  currency,
  customerName,
  onBack,
}: {
  request: Omit<CheckoutBody, "provider" | "paymentMethod">;
  totalMinor: number;
  currency: string;
  customerName: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethodChoice>("CARD");
  const [session, setSession] = useState<CheckoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [business, setBusiness] = useState(false);
  const [gstin, setGstin] = useState("");
  const normalizedGstin = normalizeGstin(gstin);
  const gstinValid = isValidGstin(normalizedGstin);
  const countdown = useCountdown(session?.reservationExpiresAt ?? null);

  const provider = METHODS.find((m) => m.value === method)!.provider;
  const body: CheckoutBody = useMemo(
    () => ({ ...request, provider, paymentMethod: method, ...(business && gstinValid ? { customerGstin: normalizedGstin } : {}) }),
    [request, provider, method, business, gstinValid, normalizedGstin],
  );
  // Same body -> same key (safe retries); any change -> a new attempt.
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const fingerprint = JSON.stringify(body);
  if (!keyRef.current || keyRef.current.fingerprint !== fingerprint) {
    keyRef.current = { fingerprint, key: newIdempotencyKey() };
  }

  const completeUrl = (orderNumber: string) => `/checkout/complete?order=${encodeURIComponent(orderNumber)}`;

  const launchRazorpay = async (checkout: CheckoutResponse) => {
    if (checkout.payment.provider !== "RAZORPAY") return;
    const payment = checkout.payment;
    await openRazorpay(
      {
        key: payment.keyId,
        amount: payment.amountMinor,
        currency: payment.currency,
        order_id: payment.providerOrderId,
        name: "Collab",
        description: `Order ${payment.orderNumber}`,
        prefill: { name: payment.prefill.name ?? undefined, email: payment.prefill.email ?? undefined, contact: payment.prefill.contact ?? undefined },
        method: { card: false, upi: method === "UPI", netbanking: method === "NETBANKING", wallet: method === "WALLET" },
        theme: { color: "#000000" },
        handler: () => router.push(completeUrl(checkout.orderNumber)),
        modal: { ondismiss: () => setError("Payment was not completed. You can try again while your items are reserved.") },
      },
      (message) => setError(message),
    );
  };

  const payNow = async () => {
    setError(null);
    if (business && !gstinValid) {
      setError("Enter a valid 15-character GSTIN, or untick the business purchase option.");
      return;
    }
    setPending(true);
    try {
      const checkout =
        session ??
        (await apiFetch<CheckoutResponse>("/api/checkout", {
          method: "POST",
          body,
          headers: { "Idempotency-Key": keyRef.current!.key },
        }));
      setSession(checkout);
      if (checkout.payment.provider === "RAZORPAY") await launchRazorpay(checkout);
    } catch (failure) {
      // A finished / cancelled attempt cannot be reused: the next click starts a fresh one.
      keyRef.current = null;
      setError(failure instanceof ApiClientError ? failure.message : failure instanceof Error ? failure.message : "Payment could not be started.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="payment-title">
      <h2 id="payment-title" className="text-xl font-semibold">
        Payment
      </h2>

      <div role="tablist" aria-label="Payment method" className="mt-6 flex gap-6 overflow-x-auto border-b border-line scrollbar-none">
        {METHODS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={method === option.value}
            disabled={session !== null}
            onClick={() => setMethod(option.value)}
            className={cn(
              "whitespace-nowrap border-b-2 pb-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
              method === option.value ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <CardPreview name={customerName} totalMinor={totalMinor} currency={currency} method={method} />

      <div className="mt-6 rounded-[var(--radius-card)] border border-line p-4">
        <label className="flex items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" checked={business} disabled={session !== null} onChange={(event) => setBusiness(event.target.checked)} className="size-4 accent-black" />
          Buying for a business? Add your GSTIN for input tax credit
        </label>
        {business && (
          <div className="mt-3">
            <label htmlFor="customer-gstin" className="mb-1.5 block text-xs text-muted-2">
              GSTIN (printed on your tax invoice)
            </label>
            <input
              id="customer-gstin"
              value={gstin}
              onChange={(event) => setGstin(event.target.value.toUpperCase().slice(0, 15))}
              disabled={session !== null}
              placeholder="29ABCDE1234F1Z5"
              autoComplete="off"
              aria-invalid={gstin.length > 0 && !gstinValid}
              className="h-11 w-full max-w-xs rounded-[7px] border border-line-2 px-3 font-mono text-sm uppercase tracking-wide focus:border-ink focus:outline-none"
            />
            {gstin.length === 15 && !gstinValid && <p className="mt-1 text-xs text-danger">This GSTIN is not valid (check the characters).</p>}
          </div>
        )}
      </div>

      {session && countdown && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-2" role="timer" aria-live="off">
          <Clock className="size-4" aria-hidden /> Items reserved for <span className="font-semibold text-ink">{countdown}</span> · Order {session.orderNumber}
        </p>
      )}

      {session?.payment.provider === "STRIPE" ? (
        <Elements
          stripe={stripeFor(session.payment.publishableKey)}
          options={{
            clientSecret: session.payment.clientSecret,
            appearance: { theme: "stripe", variables: { colorPrimary: "#000000", borderRadius: "7px", fontFamily: "Inter, system-ui, sans-serif" } },
          }}
        >
          <StripeConfirm orderNumber={session.orderNumber} totalLabel={formatMoney(session.totals.totalMinor, session.currency)} completeUrl={completeUrl(session.orderNumber)} />
        </Elements>
      ) : (
        <>
          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:justify-end">
            <Button variant="outline" size="lg" className="px-16" onClick={onBack} disabled={pending || session !== null}>
              Back
            </Button>
            <Button size="lg" className="px-16" loading={pending} onClick={payNow}>
              <Lock className="size-4" aria-hidden /> {session ? "Open payment again" : `Pay ${formatMoney(totalMinor, currency)}`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function StripeConfirm({ orderNumber, totalLabel, completeUrl }: { orderNumber: string; totalLabel: string; completeUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!stripe || !elements) return;
    setPending(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${completeUrl}` },
    });
    // Only reached on immediate errors; success redirects to return_url.
    setError(result.error?.message ?? `Payment for ${orderNumber} could not be completed.`);
    setPending(false);
  };

  return (
    <div className="mt-6">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      <Button size="lg" block className="mt-6" loading={pending} disabled={!stripe || !elements} onClick={confirm}>
        <Lock className="size-4" aria-hidden /> Pay {totalLabel}
      </Button>
    </div>
  );
}

/** Interactive dark card preview (Figma). Card details themselves live in Stripe's iframe. */
function CardPreview({ name, totalMinor, currency, method }: { name: string; totalMinor: number; currency: string; method: PaymentMethodChoice }) {
  const label = METHODS.find((option) => option.value === method)!.label;
  return (
    <div
      className="relative mt-8 aspect-[337/200] w-full max-w-[337px] overflow-hidden rounded-2xl p-6 text-white shadow-xl"
      style={{ background: "linear-gradient(135deg, #1e1e1e 0%, #000 55%, #2c2c2c 100%)" }}
      aria-label={`Paying ${formatMoney(totalMinor, currency)} by ${label}`}
      role="img"
    >
      <div className="absolute -right-10 -top-16 size-48 rounded-full bg-white/5" aria-hidden />
      <div className="absolute -bottom-20 left-10 size-56 rounded-full bg-white/5" aria-hidden />
      <div className="relative flex items-center justify-between">
        <span className="h-7 w-10 rounded-md bg-gradient-to-br from-[#d9c38b] to-[#a8864b]" aria-hidden />
        <Wifi className="size-5 rotate-90 text-white/70" aria-hidden />
      </div>
      <p className="relative mt-8 font-mono text-lg tracking-[0.2em]">{method === "CARD" ? "•••• •••• •••• ••••" : label.toUpperCase()}</p>
      <div className="relative mt-6 flex items-end justify-between text-xs">
        <span>
          <span className="block text-white/50">Card holder</span>
          <span className="block max-w-[180px] truncate text-sm font-medium">{name || "—"}</span>
        </span>
        <span className="text-right">
          <span className="block text-white/50">Amount</span>
          <span className="block text-sm font-semibold">{formatMoney(totalMinor, currency)}</span>
        </span>
      </div>
    </div>
  );
}
