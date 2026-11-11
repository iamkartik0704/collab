import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertsPanel, AutoRefresh } from "@/components/admin/dashboard/alerts-panel";
import { OrdersChart, RevenueChart } from "@/components/admin/dashboard/charts";
import { Badge, Card, LinkTabs, PageHeader } from "@/components/admin/ui";
import { formatDate, formatInteger, formatPercent, humanize, ORDER_STATUS_TONE, relativeTime } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { hasPermission } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/utils";
import { DASHBOARD_RANGES, getDashboard, getRecentOrders, type DashboardRange, type KpiValue } from "@/server/admin/analytics.service";
import { listAlerts, visibleAlertTypes } from "@/server/admin/inventory.service";

export const metadata: Metadata = { title: "Dashboard" };

const RANGE_LABEL: Record<DashboardRange, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

function Delta({ value, invert = false, range }: { value: KpiValue; invert?: boolean; range: DashboardRange }) {
  if (value.change === null) {
    return <span className="text-xs text-muted-2">No data for the previous {RANGE_LABEL[range]}</span>;
  }
  const flat = Math.abs(value.change) < 0.005;
  const good = invert ? value.change < 0 : value.change > 0;
  const Icon = flat ? Minus : value.change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${flat ? "text-muted-2" : good ? "text-success" : "text-danger"}`}>
      <Icon className="size-3.5" aria-hidden />
      {flat ? "No change" : `${value.change > 0 ? "+" : ""}${formatPercent(value.change)}`}
      <span className="font-normal text-muted-2">vs previous {RANGE_LABEL[range]}</span>
    </span>
  );
}

function KpiTile({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-2">{label}</p>
      <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight">{value}</p>
      <div className="mt-3">{delta}</div>
    </div>
  );
}

function OpsTile({ label, value, href, tone }: { label: string; value: number; href: string | null; tone: "neutral" | "warning" | "danger" }) {
  const body = (
    <>
      <p className="text-xs text-muted-2">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${value > 0 && tone === "danger" ? "text-danger" : value > 0 && tone === "warning" ? "text-[#8a5a00]" : ""}`}>{formatInteger(value)}</p>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-[var(--radius-card)] border border-line bg-white px-4 py-3 transition-colors hover:border-ink">
      {body}
    </Link>
  ) : (
    <div className="rounded-[var(--radius-card)] border border-line bg-white px-4 py-3">{body}</div>
  );
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAdminPage("dashboard:read", "/admin");
  const params = await searchParams;
  const range: DashboardRange = params.range && params.range in DASHBOARD_RANGES ? (params.range as DashboardRange) : "30d";
  const [data, recent, alerts] = await Promise.all([
    getDashboard(range),
    getRecentOrders(8),
    listAlerts({ types: visibleAlertTypes(user.role), limit: 6 }),
  ]);
  const { kpis, operations } = data;
  const maxCategory = Math.max(1, ...data.revenueByCategory.map((row) => row.revenue));
  const maxStatus = Math.max(1, ...data.statusBreakdown.map((row) => row.count));
  const canSee = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(user.role, permission);

  return (
    <>
      <AutoRefresh seconds={60} />
      {params.denied && (
        <p role="alert" className="mb-4 rounded-md bg-[#fdecea] px-4 py-2.5 text-sm text-danger">
          Your role does not have access to that section.
        </p>
      )}
      <PageHeader
        title="Executive dashboard"
        description={`${formatDate(`${data.from}T12:00:00Z`)} – ${formatDate(`${data.to}T12:00:00Z`)} (IST). Updated ${relativeTime(data.generatedAt)}; refreshes every minute.`}
      >
        <div className="mt-4 w-fit">
          <LinkTabs
            active={range}
            items={(Object.keys(DASHBOARD_RANGES) as DashboardRange[]).map((key) => ({ key, label: `Last ${RANGE_LABEL[key]}`, href: `/admin?range=${key}` }))}
          />
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Gross revenue" value={formatMoney(kpis.grossRevenue.current)} delta={<Delta value={kpis.grossRevenue} range={range} />} />
        <KpiTile label="Net revenue" value={formatMoney(kpis.netRevenue.current)} delta={<Delta value={kpis.netRevenue} range={range} />} />
        <KpiTile label="Orders" value={formatInteger(kpis.orders.current)} delta={<Delta value={kpis.orders} range={range} />} />
        <KpiTile label="Average order value" value={formatMoney(kpis.averageOrderValue.current)} delta={<Delta value={kpis.averageOrderValue} range={range} />} />
        <KpiTile label="Units sold" value={formatInteger(kpis.unitsSold.current)} delta={<Delta value={kpis.unitsSold} range={range} />} />
        <KpiTile label="Checkout conversion" value={formatPercent(kpis.conversionRate.current)} delta={<Delta value={kpis.conversionRate} range={range} />} />
        <KpiTile label="Refunds" value={formatMoney(kpis.refunds.current)} delta={<Delta value={kpis.refunds} invert range={range} />} />
        <div className="grid grid-cols-2 gap-2">
          <OpsTile label="To fulfil" value={operations.awaitingFulfilment} href={canSee("orders:read") ? "/admin/orders?view=fulfil" : null} tone="warning" />
          <OpsTile label="Low stock" value={operations.lowStock} href={canSee("inventory:write") ? "/admin/inventory?filter=low" : null} tone="warning" />
          <OpsTile label="Out of stock" value={operations.outOfStock} href={canSee("inventory:write") ? "/admin/inventory?filter=out" : null} tone="danger" />
          <OpsTile label="Pending refunds" value={operations.pendingRefunds} href={null} tone="neutral" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Revenue" className="xl:col-span-2">
          <RevenueChart series={data.series} />
        </Card>
        <Card title={`Open alerts (${operations.openAlerts})`} bodyClassName="max-h-[380px] overflow-y-auto p-5">
          <AlertsPanel alerts={alerts} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Orders per day" className="xl:col-span-2">
          <OrdersChart series={data.series} />
        </Card>
        <Card title="Revenue by category">
          {data.revenueByCategory.length === 0 ? (
            <p className="text-sm text-muted-2">No sales in this period.</p>
          ) : (
            <ul className="space-y-3">
              {data.revenueByCategory.map((row) => (
                <li key={row.category}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span>{row.category}</span>
                    <span className="font-medium tabular-nums">{formatMoney(row.revenue)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-surface" aria-hidden>
                    <div className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${Math.max(2, (row.revenue / maxCategory) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-2">{formatInteger(row.units)} units</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Top products" bodyClassName="p-0">
          <ol className="divide-y divide-line">
            {data.topProducts.length === 0 && <li className="px-5 py-4 text-sm text-muted-2">No sales in this period.</li>}
            {data.topProducts.map((product, index) => (
              <li key={product.productId} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="w-4 text-xs font-semibold text-muted-2 tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                <span className="text-xs text-muted-2 tabular-nums">{formatInteger(product.units)} sold</span>
                <span className="w-24 text-right font-medium tabular-nums">{formatMoney(product.revenue)}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Orders by status">
          <ul className="space-y-2.5">
            {data.statusBreakdown.map((row) => (
              <li key={row.status} className="grid grid-cols-[120px_1fr_44px] items-center gap-3 text-sm">
                <span className="truncate">{humanize(row.status)}</span>
                <div className="h-2 rounded-full bg-surface" aria-hidden>
                  <div className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${Math.max(2, (row.count / maxStatus) * 100)}%` }} />
                </div>
                <span className="text-right font-medium tabular-nums">{formatInteger(row.count)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Latest orders" bodyClassName="p-0" actions={canSee("orders:read") ? <Link href="/admin/orders" className="text-xs font-medium text-muted-2 hover:text-ink">View all</Link> : null}>
          <ul className="divide-y divide-line">
            {recent.map((order) => (
              <li key={order.orderNumber} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  {canSee("orders:read") ? (
                    <Link href={`/admin/orders/${order.orderNumber}`} className="font-medium hover:underline">
                      {order.orderNumber}
                    </Link>
                  ) : (
                    <span className="font-medium">{order.orderNumber}</span>
                  )}
                  <p className="truncate text-xs text-muted-2">
                    {order.customer} · {relativeTime(order.placedAt)}
                  </p>
                </div>
                <Badge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>{humanize(order.status)}</Badge>
                <span className="w-24 text-right font-medium tabular-nums">{formatMoney(order.totalMinor)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
