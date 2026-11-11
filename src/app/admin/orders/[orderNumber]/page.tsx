import { ChevronLeft, FileText, Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderActions } from "@/components/admin/orders/order-actions";
import { RefundPanel } from "@/components/admin/orders/refund-panel";
import { ReturnRequests } from "@/components/admin/orders/return-requests";
import { TrackingForm } from "@/components/admin/orders/tracking-form";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { formatDate, formatDateTime, humanize, ORDER_STATUS_TONE } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { hasPermission } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/utils";
import { getAdminOrder } from "@/server/admin/orders.service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orderNumber: string }> }): Promise<Metadata> {
  return { title: `Order ${(await params).orderNumber}` };
}

function addressLines(address: Record<string, unknown>): string[] {
  const text = (key: string) => (typeof address[key] === "string" && address[key] ? (address[key] as string) : null);
  return [
    text("fullName"),
    text("line1"),
    text("line2"),
    text("landmark") ? `Near ${text("landmark")}` : null,
    [text("city"), text("state"), text("postalCode")].filter(Boolean).join(", "),
    text("phone"),
  ].filter((line): line is string => Boolean(line));
}

export default async function AdminOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const user = await requireAdminPage("orders:read", `/admin/orders/${orderNumber}`);
  const order = await getAdminOrder(orderNumber.toUpperCase());
  if (!order) notFound();

  const canManage = hasPermission(user.role, "orders:manage");
  const canRefund = hasPermission(user.role, "refunds:issue");
  const money = (minor: number) => formatMoney(minor, order.currency);
  const trackingEditable = !["CANCELLED", "PAYMENT_FAILED", "PENDING_PAYMENT", "RETURNED"].includes(order.status);

  return (
    <>
      <Link href="/admin/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Orders
      </Link>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        actions={
          canManage ? (
            <OrderActions
              orderNumber={order.orderNumber}
              status={order.status}
              allowed={order.allowedTransitions}
              canRefund={canRefund}
              refundableMinor={order.refundableMinor}
              currency={order.currency}
              hasTracking={Boolean(order.shipping.carrierName && order.shipping.trackingNumber)}
              items={order.items.map((item) => ({ id: item.id, label: `${item.productName} · ${item.variantTitle}`, sku: item.sku, quantity: item.quantity, serialNumbers: item.serialNumbers }))}
            />
          ) : null
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-2">
          <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>{humanize(order.status)}</Badge>
          <span>Created {formatDateTime(order.createdAt)}</span>
          {order.placedAt && <span>· Paid {formatDateTime(order.placedAt)}</span>}
        </div>
      </PageHeader>

      {order.cancelReason && (
        <p className="mb-5 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm">
          <span className="font-medium">Cancellation reason:</span> {humanize(order.cancelReason)}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Items" bodyClassName="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th align="right">Unit price</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Line total</Th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className="relative size-11 shrink-0 overflow-hidden rounded bg-surface">
                          {item.imageUrl && <Image src={item.imageUrl} alt="" fill sizes="44px" className="object-contain" unoptimized />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{item.productName}</span>
                          <span className="block text-xs text-muted-2">
                            {item.variantTitle} · <span className="font-mono">{item.sku}</span>
                          </span>
                          {item.serialNumbers.length > 0 && (
                            <span className="mt-1 block font-mono text-[11px] text-muted-2">S/N: {item.serialNumbers.join(", ")}</span>
                          )}
                          {item.refundedQuantity > 0 && (
                            <span className="mt-1 block">
                              <Badge tone="warning">{item.refundedQuantity} refunded</Badge>
                            </span>
                          )}
                        </span>
                      </div>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {money(item.unitPriceMinor)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {item.quantity}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {money(item.lineTotalMinor)}
                      {item.discountMinor > 0 && <span className="block text-xs text-success">−{money(item.discountMinor)} discount</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-2">Subtotal</dt>
                <dd className="tabular-nums">{money(order.totals.subtotalMinor)}</dd>
              </div>
              {order.totals.discountMinor > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-2">Discount {order.couponCode && <span className="font-mono text-xs">({order.couponCode})</span>}</dt>
                  <dd className="tabular-nums text-success">−{money(order.totals.discountMinor)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-2">Shipping</dt>
                <dd className="tabular-nums">{order.totals.shippingMinor === 0 ? "Free" : money(order.totals.shippingMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-2">GST included</dt>
                <dd className="tabular-nums">{money(order.totals.taxMinor)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(order.totals.totalMinor)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Payments & refunds">
            {order.payments.length === 0 ? (
              <p className="text-sm text-muted-2">No payment attempt yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium">
                        {humanize(payment.provider)} {payment.method && <span className="font-normal text-muted-2">· {humanize(payment.method)}</span>}
                      </p>
                      <p className="font-mono text-xs text-muted-2">{payment.providerPaymentId ?? "—"}</p>
                      {payment.failureMessage && <p className="mt-1 text-xs text-danger">{payment.failureMessage}</p>}
                    </div>
                    <div className="text-right">
                      <Badge tone={payment.status === "SUCCEEDED" ? "success" : payment.status === "FAILED" ? "danger" : payment.status.includes("REFUNDED") ? "warning" : "neutral"}>
                        {humanize(payment.status)}
                      </Badge>
                      <p className="mt-1 text-sm font-medium tabular-nums">{money(payment.amountMinor)}</p>
                      {payment.amountRefundedMinor > 0 && <p className="text-xs text-danger tabular-nums">−{money(payment.amountRefundedMinor)} refunded</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <RefundPanel
              orderNumber={order.orderNumber}
              currency={order.currency}
              canRefund={canRefund}
              refundableMinor={order.refundableMinor}
              dispatched={["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"].includes(order.status)}
              items={order.items.map((item) => ({ id: item.id, label: `${item.productName} · ${item.variantTitle}`, sku: item.sku, quantity: item.quantity, refundedQuantity: item.refundedQuantity, lineTotalMinor: item.lineTotalMinor }))}
              refunds={order.refunds}
            />
          </Card>

          {order.returns.length > 0 && (
            <Card title={`Return & warranty requests (${order.returns.filter((request) => request.status === "REQUESTED").length} open)`}>
              <ReturnRequests requests={order.returns} canManage={canManage} />
            </Card>
          )}

          <Card title="Timeline">
            <ol className="relative space-y-4 border-l border-line pl-5">
              {order.history.map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-white bg-ink" aria-hidden />
                  <p className="text-sm">
                    <span className="font-medium">{humanize(entry.toStatus)}</span>
                    {entry.fromStatus && <span className="text-muted-2"> from {humanize(entry.fromStatus).toLowerCase()}</span>}
                  </p>
                  <p className="text-xs text-muted-2">
                    {formatDateTime(entry.createdAt)} · {entry.actor ?? "System"}
                  </p>
                  {entry.note && <p className="mt-0.5 text-xs text-muted-2">{entry.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Customer">
            <p className="font-medium">{order.customer.name ?? "—"}</p>
            <p className="text-xs text-muted-2">
              {order.customer.orderCount} order{order.customer.orderCount === 1 ? "" : "s"}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {order.customer.email && (
                <li className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-2" aria-hidden />
                  <a href={`mailto:${order.customer.email}`} className="truncate hover:underline">
                    {order.customer.email}
                  </a>
                </li>
              )}
              {order.customer.phone && (
                <li className="flex items-center gap-2">
                  <Phone className="size-4 text-muted-2" aria-hidden />
                  <a href={`tel:${order.customer.phone}`} className="hover:underline">
                    {order.customer.phone}
                  </a>
                </li>
              )}
            </ul>
            {order.customerNote && (
              <p className="mt-3 rounded-md bg-tint-1 p-3 text-sm">
                <span className="block text-xs font-medium text-muted-2">Customer note</span>
                {order.customerNote}
              </p>
            )}
          </Card>

          <Card title="Shipping">
            <address className="text-sm not-italic leading-relaxed">
              {addressLines(order.shippingAddress).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <p className="mt-3 text-sm">
              <span className="text-muted-2">Method:</span> {order.shipping.methodName}
            </p>
            {order.shipping.scheduledDate && (
              <p className="text-sm">
                <span className="text-muted-2">Scheduled:</span> {formatDate(order.shipping.scheduledDate)} {order.shipping.scheduledSlot}
              </p>
            )}
            <div className="mt-4 border-t border-line pt-4">
              <TrackingForm
                orderNumber={order.orderNumber}
                editable={canManage && trackingEditable}
                initial={{ carrierName: order.shipping.carrierName ?? "", trackingNumber: order.shipping.trackingNumber ?? "", trackingUrl: order.shipping.trackingUrl ?? "" }}
              />
            </div>
          </Card>

          {(order.invoiceNumber || order.creditNotes.length > 0 || order.customerGstin) && (
            <Card title="GST documents">
              {order.customerGstin && (
                <p className="mb-2 text-sm">
                  <span className="text-muted-2">Buyer GSTIN:</span> <span className="font-mono">{order.customerGstin}</span>
                </p>
              )}
              {order.invoiceNumber && (
                <a href={`/api/orders/${order.orderNumber}/invoice`} className="flex items-center gap-2 text-sm font-medium hover:underline">
                  <FileText className="size-4" aria-hidden /> Invoice {order.invoiceNumber}
                </a>
              )}
              {order.creditNotes.map((note) => (
                <a key={note.id} href={`/api/orders/${order.orderNumber}/credit-notes/${note.id}`} className="mt-1.5 flex items-center gap-2 text-sm hover:underline">
                  <FileText className="size-4" aria-hidden /> Credit note {note.creditNoteNumber} · {money(note.amountMinor)}
                </a>
              ))}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
