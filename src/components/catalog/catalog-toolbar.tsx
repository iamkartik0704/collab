"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { CatalogResult, CatalogSort } from "@/types/catalog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCatalogNavigation } from "./catalog-frame";
import { FilterSidebar } from "./filter-sidebar";

const SORT_OPTIONS: Array<{ value: CatalogSort; label: string }> = [
  { value: "rating", label: "By rating" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "newest", label: "Newest" },
];

/** "Selected Products: N" + sort dropdown; mobile gets a Filters button that opens a drawer. */
export function CatalogToolbar({ result }: { result: CatalogResult }) {
  const { update } = useCatalogNavigation();
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-base text-muted-2">
        Selected Products: <span className="text-xl font-medium text-ink">{result.total}</span>
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="flex h-10 items-center gap-2 rounded-md border border-line-2 px-4 text-sm font-medium lg:hidden"
        >
          <SlidersHorizontal className="size-4" /> Filters
        </button>
        <label className="relative flex h-10 items-center">
          <span className="sr-only">Sort products</span>
          <select
            value={result.sort}
            onChange={(event) => update({ sort: event.target.value === "rating" ? null : event.target.value })}
            className="h-10 min-w-[200px] appearance-none rounded-md border border-line-2 bg-white pl-4 pr-10 text-sm font-medium focus:border-ink focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 size-4" aria-hidden />
        </label>
      </div>
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" title="Filters" className="max-w-[340px]">
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <FilterSidebar facets={result.facets} price={result.price} />
          </div>
          <div className="border-t border-line p-4">
            <button type="button" onClick={() => setFiltersOpen(false)} className="h-12 w-full rounded-md bg-ink text-sm font-medium text-white">
              Show {result.total} products
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function CatalogPagination({ page, pageCount }: { page: number; pageCount: number }) {
  const { update } = useCatalogNavigation();
  if (pageCount <= 1) return null;
  const pages: Array<number | "gap"> = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages.at(-1) !== "gap") pages.push("gap");
  }
  const go = (target: number) => {
    update({ page: target === 1 ? null : String(target) }, { keepPage: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-2">
      <button type="button" disabled={page <= 1} onClick={() => go(page - 1)} className="h-10 rounded-md px-3 text-sm disabled:opacity-30" aria-label="Previous page">
        ‹
      </button>
      {pages.map((p, index) =>
        p === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-muted">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            aria-current={p === page ? "page" : undefined}
            className={p === page ? "size-10 rounded-md bg-ink text-sm font-medium text-white" : "size-10 rounded-md bg-surface text-sm font-medium hover:bg-surface-2"}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" disabled={page >= pageCount} onClick={() => go(page + 1)} className="h-10 rounded-md px-3 text-sm disabled:opacity-30" aria-label="Next page">
        ›
      </button>
    </nav>
  );
}
