import { ChevronLeft, FileText, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReturnRequestPanel } from "@/components/account/return-request-panel";
import { getAuthState } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { returnEligibility } from "@/server/returns/return.service";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  PAYMENT_FAILED: "Payment failed",
  RETURNED: "Returned",
};

const RETURN_STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Under review",
  APPROVED: "Approved - we'll arrange the pickup",
  REJECTED: "Not approved",
  PICKUP_SCHEDULED: "Pickup scheduled",
  RECEIVED: "Received at our warehouse",
  REFUNDED: "Refunded",
  CLOSED: "Closed",
};

const dateFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default async function CustomerOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber: raw } = await params;
  const orderNumber = raw.toUpperCase();
  const path = `/account/orders/${encodeURIComponent(orderNumber)}`;
  const state = await getAuthState();
  if (state.status === "expired") redirect(`/api/auth/refresh?callbackUrl=${encodeURIComponent(path)}`);
  if (state.status !== "authenticated") redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);

  const order = await db.order.findUnique({
    where: { orderNumber },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      returnRequests: { orderBy: { createdAt: "desc" }, include: { orderItem: { select: { productName: true, variantTitle: true } } } },
      creditNotes: { orderBy: { issuedAt: "asc" }, select: { id: true, creditNoteNumber: true, amountMinor: true, issuedAt: true } },
    },
  });
  // Someone else's order looks exactly like a missing one.
  if (!order || order.userId !== state.user.id || order.status === "PENDING_PAYMENT") notFound();
  const eligibility = await returnEligibility(order.id);
  const money = (minor: number) => formatMoney(minor, order.currency);

  return (
    <div className="container-site max-w-4xl py-12">
      <Link href="/account" className="inline-flex items-center gap-1 text-sm text-muted-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Your account
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Order {order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-2">
            Placed {dateFormat.format(order.placedAt ?? order.createdAt)} · {STATUS_LABELS[order.status] ?? order.status}
            {order.deliveredAt && ` on ${dateFormat.format(order.deliveredAt)}`}
          </p>
        </div>
        {order.placedAt && (
          <a href={`/api/orders/${order.orderNumber}/invoice`} className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">
            <FileText className="size-4" aria-hidden /> Tax invoice (PDF)
          </a>
        )}
      </div>

      {order.trackingNumber && (
        <p className="mt-6 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-surface p-4 text-sm">
          <Truck className="size-4" aria-hidden /> {order.carrierName} · <span className="font-mono">{order.trackingNumber}</span>
          {order.trackingUrl && (
            <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">
              Track shipment
            </a>
          )}
        </p>
      )}

      <section aria-labelledby="items-title" className="mt-8">
        <h2 id="items-title" className="text-xl font-medium">
          Items
        </h2>
        <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium">{item.productName}</p>
                <p className="text-sm text-muted-2">
                  {item.variantTitle} · Qty {item.quantity}
                  {item.refundedQuantity > 0 && ` · ${item.refundedQuantity} refunded`}
                </p>
                {item.serialNumbers.length > 0 && <p className="mt-1 font-mono text-xs text-muted-2">S/N / IMEI: {item.serialNumbers.join(", ")}</p>}
              </div>
              <span className="font-semibold">{money(item.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-right text-sm">
          Total paid <span className="ml-2 text-base font-semibold">{money(order.totalMinor)}</span>
          {order.customerGstin && <span className="block text-xs text-muted-2">GSTIN {order.customerGstin}</span>}
        </p>
      </section>

      {order.creditNotes.length > 0 && (
        <section aria-labelledby="credit-title" className="mt-8">
          <h2 id="credit-title" className="text-xl font-medium">
            Refunds & credit notes
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {order.creditNotes.map((note) => (
              <li key={note.id}>
                <a href={`/api/orders/${order.orderNumber}/credit-notes/${note.id}`} className="underline underline-offset-4">
                  {note.creditNoteNumber}
                </a>{" "}
                · {money(note.amountMinor)} · {dateFormat.format(note.issuedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.returnRequests.length > 0 && (
        <section aria-labelledby="returns-title" className="mt-8">
          <h2 id="returns-title" className="text-xl font-medium">
            Return & warranty requests
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {order.returnRequests.map((request) => (
              <li key={request.id} className="px-5 py-3 text-sm">
                <p className="font-medium">
                  {request.rmaNumber} · {request.type === "WARRANTY_REPAIR" ? "Warranty" : request.type === "REPLACEMENT" ? "Replacement" : "Return"} · {request.orderItem.productName}
                </p>
                <p className="text-muted-2">
                  {RETURN_STATUS_LABELS[request.status] ?? request.status} · {request.reason} · requested {dateFormat.format(request.createdAt)}
                </p>
                {request.resolutionNote && <p className="mt-1">{request.resolutionNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.status === "DELIVERED" && (
        <ReturnRequestPanel
          orderNumber={order.orderNumber}
          items={order.items.map((item) => {
            const rule = eligibility.find((entry) => entry.orderItemId === item.id);
            return {
              id: item.id,
              label: `${item.productName} (${item.variantTitle})`,
              returnableQuantity: rule?.returnableQuantity ?? 0,
              canReturn: rule?.canReturn ?? false,
              canWarranty: rule?.canWarranty ?? false,
              returnWindowEndsAt: rule?.returnWindowEndsAt ?? null,
              warrantyEndsAt: rule?.warrantyEndsAt ?? null,
            };
          })}
        />
      )}
    </div>
  );
}
