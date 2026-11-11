import { ClipboardList, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, inputClass, LinkTabs, PageHeader, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { dayBound, formatDateTime, humanize, ORDER_STATUS_TONE } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { formatMoney } from "@/lib/utils";
import { listAdminOrders, ORDER_VIEWS, type OrderView } from "@/server/admin/orders.service";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const PAYMENT_TONE = { SUCCEEDED: "success", PARTIALLY_REFUNDED: "warning", REFUNDED: "neutral", FAILED: "danger", CANCELLED: "neutral" } as const;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage("orders:read", "/admin/orders");
  const params = await searchParams;
  const view: OrderView = params.view && params.view in ORDER_VIEWS ? (params.view as OrderView) : "all";
  const from = dayBound(params.from, false);
  const to = dayBound(params.to, true);
  const result = await listAdminOrders({
    q: params.q?.slice(0, 80),
    view,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    page: Number(params.page) || 1,
  });

  const keep = { q: params.q, from: params.from, to: params.to };
  const href = (target: OrderView) => {
    const search = new URLSearchParams(Object.entries({ ...keep, view: target === "all" ? undefined : target }).filter((entry): entry is [string, string] => Boolean(entry[1])));
    const text = search.toString();
    return text ? `/admin/orders?${text}` : "/admin/orders";
  };

  return (
    <>
      <PageHeader title="Orders" description="Fulfilment queue, payments and refunds. Status changes notify the customer by email and WhatsApp." />
      <div className="mb-4">
        <LinkTabs
          active={view}
          items={(Object.keys(ORDER_VIEWS) as OrderView[]).map((key) => ({ key, label: ORDER_VIEWS[key].label, href: href(key), count: result.counts[key] }))}
        />
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <label className="relative min-w-[240px] flex-1">
          <span className="mb-1 block text-xs text-muted-2">Search</span>
          <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted" aria-hidden />
          <input name="q" defaultValue={params.q} placeholder="Order number, email, phone or name" className={`${inputClass} pl-9`} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">From</span>
          <input type="date" name="from" defaultValue={params.from} className={inputClass} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">To</span>
          <input type="date" name="to" defaultValue={params.to} className={inputClass} />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      <Card bodyClassName="p-0">
        {result.rows.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-8" />} title="No orders here">
            Orders appear as soon as a customer starts checkout.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Placed</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Payment</Th>
                <Th align="right">Items</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((order) => (
                <tr key={order.orderNumber} className="hover:bg-tint-1">
                  <Td>
                    <Link href={`/admin/orders/${order.orderNumber}`} className="font-mono text-xs font-semibold hover:underline">
                      {order.orderNumber}
                    </Link>
                    <span className="block text-xs text-muted-2">{order.shippingMethodName}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-2">{formatDateTime(order.createdAt)}</Td>
                  <Td>
                    <span className="block max-w-[200px] truncate">{order.customerName ?? "—"}</span>
                    <span className="block max-w-[200px] truncate text-xs text-muted-2">{order.customerEmail}</span>
                  </Td>
                  <Td>
                    <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>{humanize(order.status)}</Badge>
                  </Td>
                  <Td>
                    {order.paymentStatus ? (
                      <span className="flex flex-col gap-0.5">
                        <Badge tone={PAYMENT_TONE[order.paymentStatus as keyof typeof PAYMENT_TONE] ?? "neutral"}>{humanize(order.paymentStatus)}</Badge>
                        <span className="text-[11px] text-muted-2">{order.paymentProvider && humanize(order.paymentProvider)}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {order.itemCount}
                  </Td>
                  <Td align="right" className="whitespace-nowrap tabular-nums">
                    <span className="font-medium">{formatMoney(order.totalMinor, order.currency)}</span>
                    {order.refundedMinor > 0 && <span className="block text-xs text-danger">−{formatMoney(order.refundedMinor, order.currency)} refunded</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pagination page={result.page} pageCount={result.pageCount} basePath="/admin/orders" params={{ ...keep, view: view === "all" ? undefined : view }} />
    </>
  );
}
