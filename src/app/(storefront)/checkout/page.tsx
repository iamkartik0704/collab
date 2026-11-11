import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import type { ShippingMethodView } from "@/components/checkout/shipping-step";
import { getAuthState } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listAddresses } from "@/server/account/address.service";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

/** Middleware already requires a fresh session here; this re-checks server-side. */
export default async function CheckoutPage() {
  const state = await getAuthState();
  if (state.status === "expired") redirect("/api/auth/refresh?callbackUrl=%2Fcheckout");
  if (state.status !== "authenticated") redirect("/login?callbackUrl=%2Fcheckout");

  const [addresses, methods] = await Promise.all([
    listAddresses(state.user.id),
    db.shippingMethod.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { priceMinor: "asc" }],
      select: { code: true, name: true, description: true, speed: true, priceMinor: true, freeAboveMinor: true, minDays: true, maxDays: true, requiresSlot: true },
    }),
  ]);

  return <CheckoutFlow initialAddresses={addresses} shippingMethods={methods as ShippingMethodView[]} customerName={state.user.name ?? ""} />;
}
