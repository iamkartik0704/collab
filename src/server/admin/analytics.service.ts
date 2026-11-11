import { db } from "@/lib/db";
import { cached, hashedCacheKey } from "@/lib/redis";

/**
 * Executive analytics. Daily KPIs are rolled up into DailyMetric (by IST calendar day) by the
 * worker every 15 minutes; the dashboard back-fills any missing day on demand and always
 * recomputes today and yesterday so the current numbers are live.
 *
 * Definitions (all INR, minor units):
 *   gross revenue    total of orders whose payment was confirmed that day (placedAt)
 *   refunds          refunds that succeeded that day
 *   net revenue      gross - refunds
 *   checkouts        orders created that day (any outcome)
 *   conversion       orders placed / checkouts started
 */

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
export const DASHBOARD_RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type DashboardRange = keyof typeof DASHBOARD_RANGES;

/** yyyy-mm-dd of `date` in the business time zone. */
export function businessDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Recomputes DailyMetric rows for every IST day in [fromDay, toDay]. Idempotent. */
export async function rollupDailyMetrics(fromDay: string, toDay: string): Promise<number> {
  return db.$executeRaw`
    WITH days AS (
      SELECT d::date AS day FROM generate_series(${fromDay}::date, ${toDay}::date, interval '1 day') AS d
    ),
    bounds AS (
      SELECT (${fromDay}::date)::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE} AS lo,
             ((${toDay}::date + 1))::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE} AS hi
    ),
    placed AS (
      SELECT (o."placedAt" AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS day, count(*)::int AS orders, sum(o."totalMinor")::bigint AS gross
        FROM "Order" o, bounds b
       WHERE o."placedAt" >= b.lo AND o."placedAt" < b.hi AND o.currency = 'INR'
       GROUP BY 1
    ),
    units AS (
      SELECT (o."placedAt" AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS day, sum(i.quantity)::int AS units
        FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId", bounds b
       WHERE o."placedAt" >= b.lo AND o."placedAt" < b.hi AND o.currency = 'INR'
       GROUP BY 1
    ),
    started AS (
      SELECT (o."createdAt" AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS day, count(*)::int AS checkouts
        FROM "Order" o, bounds b
       WHERE o."createdAt" >= b.lo AND o."createdAt" < b.hi AND o.currency = 'INR'
       GROUP BY 1
    ),
    refunded AS (
      SELECT (r."processedAt" AT TIME ZONE ${BUSINESS_TIME_ZONE})::date AS day, sum(r."amountMinor")::bigint AS refunds
        FROM "Refund" r JOIN "Order" o ON o.id = r."orderId", bounds b
       WHERE r.status = 'SUCCEEDED' AND r."processedAt" >= b.lo AND r."processedAt" < b.hi AND o.currency = 'INR'
       GROUP BY 1
    )
    INSERT INTO "DailyMetric" (date, currency, "grossMerchandiseMinor", "netRevenueMinor", "refundsMinor",
                               "ordersCount", "unitsSold", "checkoutsStarted", "averageOrderValueMinor", "updatedAt")
    SELECT d.day, 'INR',
           coalesce(p.gross, 0),
           coalesce(p.gross, 0) - coalesce(r.refunds, 0),
           coalesce(r.refunds, 0),
           coalesce(p.orders, 0),
           coalesce(u.units, 0),
           coalesce(s.checkouts, 0),
           CASE WHEN coalesce(p.orders, 0) > 0 THEN (p.gross / p.orders)::int ELSE 0 END,
           now()
      FROM days d
      LEFT JOIN placed p ON p.day = d.day
      LEFT JOIN units u ON u.day = d.day
      LEFT JOIN started s ON s.day = d.day
      LEFT JOIN refunded r ON r.day = d.day
    ON CONFLICT (date) DO UPDATE SET
      "grossMerchandiseMinor" = EXCLUDED."grossMerchandiseMinor",
      "netRevenueMinor" = EXCLUDED."netRevenueMinor",
      "refundsMinor" = EXCLUDED."refundsMinor",
      "ordersCount" = EXCLUDED."ordersCount",
      "unitsSold" = EXCLUDED."unitsSold",
      "checkoutsStarted" = EXCLUDED."checkoutsStarted",
      "averageOrderValueMinor" = EXCLUDED."averageOrderValueMinor",
      "updatedAt" = now()`;
}

/** Worker entry point: keeps today and yesterday fresh. */
export async function rollupRecentMetrics(): Promise<number> {
  const today = businessDay();
  return rollupDailyMetrics(addDays(today, -1), today);
}

export interface KpiValue {
  current: number;
  previous: number;
  /** Relative change, null when the previous period was zero. */
  change: number | null;
}

export interface DashboardData {
  range: DashboardRange;
  from: string;
  to: string;
  generatedAt: string;
  kpis: {
    grossRevenue: KpiValue;
    netRevenue: KpiValue;
    orders: KpiValue;
    averageOrderValue: KpiValue;
    unitsSold: KpiValue;
    conversionRate: KpiValue;
    refunds: KpiValue;
  };
  series: Array<{ date: string; gross: number; net: number; orders: number; refunds: number }>;
  revenueByCategory: Array<{ category: string; revenue: number; units: number }>;
  topProducts: Array<{ productId: string; name: string; units: number; revenue: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  operations: { awaitingFulfilment: number; lowStock: number; outOfStock: number; openAlerts: number; pendingRefunds: number; pendingReviews: number };
}

function kpi(current: number, previous: number): KpiValue {
  return { current, previous, change: previous === 0 ? null : (current - previous) / previous };
}

async function ensureRollups(fromDay: string, toDay: string): Promise<void> {
  const totalDays = Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1;
  const present = await db.dailyMetric.count({ where: { date: { gte: new Date(`${fromDay}T00:00:00Z`), lte: new Date(`${toDay}T00:00:00Z`) } } });
  // Missing history (worker not running yet / fresh database): fill the whole window once.
  if (present < totalDays - 2) await rollupDailyMetrics(fromDay, toDay);
  else await rollupRecentMetrics();
}

export async function getDashboard(range: DashboardRange): Promise<DashboardData> {
  return cached(hashedCacheKey("admin-dashboard", { range, v: 1 }), () => computeDashboard(range), { ttlSeconds: 60, staleWhileRevalidateSeconds: 30 });
}

async function computeDashboard(range: DashboardRange): Promise<DashboardData> {
  const days = DASHBOARD_RANGES[range];
  const to = businessDay();
  const from = addDays(to, -(days - 1));
  const previousFrom = addDays(from, -days);
  const previousTo = addDays(from, -1);
  await ensureRollups(previousFrom, to);

  const metrics = await db.dailyMetric.findMany({
    where: { date: { gte: new Date(`${previousFrom}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: { date: "asc" },
  });
  const inWindow = (lo: string, hi: string) => metrics.filter((metric) => {
    const day = metric.date.toISOString().slice(0, 10);
    return day >= lo && day <= hi;
  });
  const current = inWindow(from, to);
  const previous = inWindow(previousFrom, previousTo);
  const sum = (rows: typeof metrics, pick: (row: (typeof metrics)[number]) => number | bigint) => rows.reduce((total, row) => total + Number(pick(row)), 0);

  const gross = [sum(current, (row) => row.grossMerchandiseMinor), sum(previous, (row) => row.grossMerchandiseMinor)] as const;
  const net = [sum(current, (row) => row.netRevenueMinor), sum(previous, (row) => row.netRevenueMinor)] as const;
  const orders = [sum(current, (row) => row.ordersCount), sum(previous, (row) => row.ordersCount)] as const;
  const units = [sum(current, (row) => row.unitsSold), sum(previous, (row) => row.unitsSold)] as const;
  const checkouts = [sum(current, (row) => row.checkoutsStarted), sum(previous, (row) => row.checkoutsStarted)] as const;
  const refunds = [sum(current, (row) => row.refundsMinor), sum(previous, (row) => row.refundsMinor)] as const;
  const aov = (g: number, o: number) => (o > 0 ? Math.round(g / o) : 0);
  const rate = (o: number, c: number) => (c > 0 ? o / c : 0);

  const lo = new Date(`${from}T00:00:00+05:30`);
  const [byCategory, top, statuses, operations] = await Promise.all([
    db.$queryRaw<Array<{ category: string; revenue: bigint; units: bigint }>>`
      SELECT c.name AS category, sum(i."lineTotalMinor")::bigint AS revenue, sum(i.quantity)::bigint AS units
        FROM "OrderItem" i
        JOIN "Order" o ON o.id = i."orderId"
        JOIN "Product" p ON p.id = i."productId"
        JOIN "Category" c ON c.id = p."categoryId"
       WHERE o."placedAt" >= ${lo} AND o.currency = 'INR'
       GROUP BY c.name ORDER BY revenue DESC`,
    db.$queryRaw<Array<{ productId: string; name: string; units: bigint; revenue: bigint }>>`
      SELECT i."productId", max(i."productName") AS name, sum(i.quantity)::bigint AS units, sum(i."lineTotalMinor")::bigint AS revenue
        FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
       WHERE o."placedAt" >= ${lo} AND o.currency = 'INR'
       GROUP BY i."productId" ORDER BY revenue DESC LIMIT 5`,
    db.order.groupBy({ by: ["status"], where: { createdAt: { gte: lo } }, _count: { _all: true } }),
    getOperationalCounts(),
  ]);

  return {
    range,
    from,
    to,
    generatedAt: new Date().toISOString(),
    kpis: {
      grossRevenue: kpi(gross[0], gross[1]),
      netRevenue: kpi(net[0], net[1]),
      orders: kpi(orders[0], orders[1]),
      averageOrderValue: kpi(aov(gross[0], orders[0]), aov(gross[1], orders[1])),
      unitsSold: kpi(units[0], units[1]),
      conversionRate: kpi(rate(orders[0], checkouts[0]), rate(orders[1], checkouts[1])),
      refunds: kpi(refunds[0], refunds[1]),
    },
    series: current.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      gross: Number(row.grossMerchandiseMinor),
      net: Number(row.netRevenueMinor),
      orders: row.ordersCount,
      refunds: Number(row.refundsMinor),
    })),
    revenueByCategory: byCategory.map((row) => ({ category: row.category, revenue: Number(row.revenue), units: Number(row.units) })),
    topProducts: top.map((row) => ({ productId: row.productId, name: row.name, units: Number(row.units), revenue: Number(row.revenue) })),
    statusBreakdown: statuses.map((row) => ({ status: row.status, count: row._count._all })).sort((a, b) => b.count - a.count),
    operations,
  };
}

async function getOperationalCounts(): Promise<DashboardData["operations"]> {
  const [awaitingFulfilment, stock, openAlerts, pendingRefunds, pendingReviews] = await Promise.all([
    db.order.count({ where: { status: { in: ["PLACED", "CONFIRMED", "PACKED"] } } }),
    db.$queryRaw<Array<{ low: bigint; out: bigint }>>`
      SELECT count(*) FILTER (WHERE i."quantityAvailable" > 0 AND i."quantityAvailable" <= i."lowStockThreshold") AS low,
             count(*) FILTER (WHERE i."quantityAvailable" <= 0) AS out
        FROM "InventoryItem" i JOIN "ProductVariant" v ON v.id = i."variantId"
       WHERE v."deletedAt" IS NULL AND v."isActive"`,
    db.adminAlert.count({ where: { acknowledgedAt: null } }),
    db.refund.count({ where: { status: "PENDING" } }),
    db.review.count({ where: { status: "PENDING" } }),
  ]);
  return {
    awaitingFulfilment,
    lowStock: Number(stock[0]?.low ?? 0),
    outOfStock: Number(stock[0]?.out ?? 0),
    openAlerts,
    pendingRefunds,
    pendingReviews,
  };
}

export interface RecentOrder {
  orderNumber: string;
  customer: string;
  totalMinor: number;
  status: string;
  placedAt: string;
}

export async function getRecentOrders(limit = 8): Promise<RecentOrder[]> {
  const orders = await db.order.findMany({
    where: { placedAt: { not: null } },
    orderBy: { placedAt: "desc" },
    take: limit,
    select: { orderNumber: true, totalMinor: true, status: true, placedAt: true, user: { select: { name: true, email: true } } },
  });
  return orders.map((order) => ({
    orderNumber: order.orderNumber,
    customer: order.user.name ?? order.user.email ?? "Customer",
    totalMinor: order.totalMinor,
    status: order.status,
    placedAt: order.placedAt!.toISOString(),
  }));
}
