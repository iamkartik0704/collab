import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutComplete } from "@/components/checkout/checkout-complete";

export const metadata: Metadata = { title: "Order status", robots: { index: false } };

export default async function CheckoutCompletePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const order = typeof params.order === "string" ? params.order : null;
  if (!order || !/^CLB-[0-9A-Z]{8,20}$/.test(order)) notFound();
  // Stripe appends redirect_status=succeeded|processing|failed to return_url.
  const redirectStatus = typeof params.redirect_status === "string" ? params.redirect_status : null;
  return <CheckoutComplete orderNumber={order} redirectStatus={redirectStatus} />;
}
