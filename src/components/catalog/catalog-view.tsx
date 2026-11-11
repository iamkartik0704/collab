import { SearchX } from "lucide-react";
import Link from "next/link";
import type { CatalogResult } from "@/types/catalog";
import { ProductGrid } from "@/components/product/product-card";
import { Breadcrumbs, type Crumb } from "@/components/shared/breadcrumbs";
import { Button } from "@/components/ui/button";
import { CatalogFrame, CatalogResults } from "./catalog-frame";
import { CatalogPagination, CatalogToolbar } from "./catalog-toolbar";
import { FilterSidebar } from "./filter-sidebar";

export function CatalogView({ result, title, crumbs }: { result: CatalogResult; title: string; crumbs: Crumb[] }) {
  return (
    <CatalogFrame>
      <div className="container-site pb-16">
        <Breadcrumbs items={crumbs} />
        <h1 className="sr-only">{title}</h1>
        <div className="grid gap-8 lg:grid-cols-[256px_1fr]">
          <aside aria-label="Filters" className="hidden lg:block">
            <FilterSidebar facets={result.facets} price={result.price} />
          </aside>
          <div>
            {result.query && (
              <p className="mb-2 text-sm text-muted-2">
                Results for <span className="font-medium text-ink">“{result.query}”</span>
              </p>
            )}
            <CatalogToolbar result={result} />
            <CatalogResults>
              {result.products.length ? (
                <ProductGrid products={result.products} columns={3} showDiscount={result.dealsOnly} />
              ) : (
                <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-surface py-20 text-center">
                  <SearchX className="size-10 text-muted" strokeWidth={1.5} />
                  <p className="text-lg font-medium">No products match these filters</p>
                  <p className="text-sm text-muted-2">Try removing a filter or searching for something else.</p>
                  <Button asChild variant="outline">
                    <Link href={result.category ? `/catalog/${result.category.slug}` : "/catalog"}>Reset filters</Link>
                  </Button>
                </div>
              )}
              <CatalogPagination page={result.page} pageCount={result.pageCount} />
            </CatalogResults>
          </div>
        </div>
      </div>
    </CatalogFrame>
  );
}
