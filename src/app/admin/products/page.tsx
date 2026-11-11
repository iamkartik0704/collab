import { PackagePlus, Search } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Badge, Card, EmptyState, inputClass, PageHeader, Pagination, selectClass, Table, Td, Th } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatInteger, humanize } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { PRODUCT_STATUSES } from "@/schemas/admin";
import { listAdminProducts } from "@/server/admin/products.service";

export const metadata: Metadata = { title: "Products" };

const STATUS_TONE = { ACTIVE: "success", DRAFT: "warning", ARCHIVED: "neutral" } as const;

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage("catalog:write", "/admin/products");
  const params = await searchParams;
  const status = PRODUCT_STATUSES.find((value) => value === params.status);
  const [result, categories] = await Promise.all([
    listAdminProducts({ q: params.q, status, categoryId: params.category, page: Number(params.page) || 1 }),
    db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalogue, variant matrix and media. Changes go live on the storefront immediately (caches are invalidated on save)."
        actions={
          <Button asChild size="sm">
            <Link href="/admin/products/new">
              <PackagePlus className="size-4" aria-hidden /> New product
            </Link>
          </Button>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={params.q} placeholder="Search name, slug or SKU" className={`${inputClass} pl-9`} aria-label="Search products" />
        </div>
        <select name="status" defaultValue={status ?? ""} className={selectClass} aria-label="Status">
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={params.category ?? ""} className={selectClass} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </form>

      <Card bodyClassName="p-0">
        {result.rows.length === 0 ? (
          <EmptyState title="No products match these filters" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Status</Th>
                <Th>Category</Th>
                <Th align="right">Variants</Th>
                <Th align="right">Price</Th>
                <Th align="right">Available</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((product) => (
                <tr key={product.id} className="hover:bg-tint-1">
                  <Td>
                    <Link href={`/admin/products/${product.id}`} className="flex items-center gap-3">
                      <span className="relative size-10 shrink-0 overflow-hidden rounded bg-surface">
                        {product.imageUrl && <Image src={product.imageUrl} alt="" fill sizes="40px" className="object-contain" unoptimized />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium hover:underline">{product.name}</span>
                        <span className="block text-xs text-muted-2">{product.brand}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[product.status]}>{humanize(product.status)}</Badge>
                  </Td>
                  <Td className="text-muted-2">{product.category}</Td>
                  <Td align="right" className="tabular-nums">
                    {product.variantCount}
                  </Td>
                  <Td align="right" className="whitespace-nowrap tabular-nums">
                    {product.minPriceMinor === null
                      ? "—"
                      : product.minPriceMinor === product.maxPriceMinor
                        ? formatMoney(product.minPriceMinor)
                        : `${formatMoney(product.minPriceMinor)} – ${formatMoney(product.maxPriceMinor!)}`}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatInteger(product.available)}
                    {product.lowStockVariants > 0 && (
                      <span className="ml-2">
                        <Badge tone="warning">{product.lowStockVariants} low</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-2">{formatDateTime(product.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pagination page={result.page} pageCount={result.pageCount} basePath="/admin/products" params={{ q: params.q, status, category: params.category }} />
    </>
  );
}
