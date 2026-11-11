import { StockMovementType } from "@prisma/client";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MovementsLog } from "@/components/admin/inventory/movements-log";
import { inputClass, PageHeader, selectClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { dayBound, humanize } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { listMovements } from "@/server/admin/inventory.service";

export const metadata: Metadata = { title: "Stock movements" };
export const dynamic = "force-dynamic";

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage("inventory:write", "/admin/inventory/movements");
  const params = await searchParams;
  const type = Object.values(StockMovementType).find((value) => value === params.type);
  const filters = {
    q: params.q?.slice(0, 80) || undefined,
    type,
    variantId: params.variantId?.slice(0, 64) || undefined,
    from: dayBound(params.from, false),
    to: dayBound(params.to, true),
  };
  const first = await listMovements({
    ...filters,
    from: filters.from ? new Date(filters.from) : undefined,
    to: filters.to ? new Date(filters.to) : undefined,
    limit: 50,
  });
  const apiQuery = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

  return (
    <>
      <Link href="/admin/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Inventory
      </Link>
      <PageHeader
        title="Stock movements"
        description="Append-only ledger of every stock change: reservations, sales, releases, returns and manual adjustments, with the quantities after each one."
      >
        {params.variantId && (
          <p className="mt-2 text-sm">
            Showing <span className="font-mono text-xs font-medium">{params.sku ?? params.variantId}</span> only ·{" "}
            <Link href="/admin/inventory/movements" className="underline underline-offset-2">
              show all SKUs
            </Link>
          </p>
        )}
      </PageHeader>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {params.variantId && <input type="hidden" name="variantId" value={params.variantId} />}
        {params.sku && <input type="hidden" name="sku" value={params.sku} />}
        <label className="min-w-[200px] flex-1">
          <span className="mb-1 block text-xs text-muted-2">SKU or order number</span>
          <input name="q" defaultValue={params.q} className={inputClass} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-2">Type</span>
          <select name="type" defaultValue={type ?? ""} className={selectClass}>
            <option value="">All types</option>
            {Object.values(StockMovementType).map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
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
      <MovementsLog key={apiQuery} initial={first} apiQuery={apiQuery} />
    </>
  );
}
