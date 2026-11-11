import { History, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InventoryCenter, type InventoryQuery } from "@/components/admin/inventory/inventory-center";
import { inputClass, LinkTabs, PageHeader, Pagination, selectClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { listInventory } from "@/server/admin/inventory.service";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All SKUs" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
  { key: "reserved", label: "Reserved" },
] as const;

const SORTS = { urgency: "Lowest available first", sku: "SKU A–Z", recent: "Recently changed" } as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage("inventory:write", "/admin/inventory");
  const params = await searchParams;
  const query: InventoryQuery = {
    q: (params.q ?? "").slice(0, 80),
    filter: FILTERS.find((entry) => entry.key === params.filter)?.key ?? "all",
    sort: params.sort === "sku" || params.sort === "recent" ? params.sort : "urgency",
    page: Math.max(1, Number(params.page) || 1),
  };
  const data = await listInventory(query);
  const href = (filter: string) => {
    const search = new URLSearchParams();
    if (query.q) search.set("q", query.q);
    if (filter !== "all") search.set("filter", filter);
    if (query.sort !== "urgency") search.set("sort", query.sort);
    const text = search.toString();
    return text ? `/admin/inventory?${text}` : "/admin/inventory";
  };

  return (
    <>
      <PageHeader
        title="Inventory control center"
        description="Live on-hand, reserved and available stock for every SKU. Checkout reservations, payments, expiries and adjustments stream in as they commit."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/inventory/movements">
              <History className="size-4" aria-hidden /> Movements log
            </Link>
          </Button>
        }
      />
      <div className="mb-4">
        <LinkTabs items={FILTERS.map((entry) => ({ key: entry.key, label: entry.label, href: href(entry.key) }))} active={query.filter} />
      </div>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        {query.filter !== "all" && <input type="hidden" name="filter" value={query.filter} />}
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={query.q} placeholder="Search SKU or product" className={`${inputClass} pl-9`} aria-label="Search inventory" />
        </div>
        <select name="sort" defaultValue={query.sort} className={selectClass} aria-label="Sort">
          {Object.entries(SORTS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>
      <InventoryCenter initial={data} query={query} />
      <Pagination
        page={data.page}
        pageCount={data.pageCount}
        basePath="/admin/inventory"
        params={{ q: query.q || undefined, filter: query.filter === "all" ? undefined : query.filter, sort: query.sort === "urgency" ? undefined : query.sort }}
      />
    </>
  );
}
