import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductBuilder } from "@/components/admin/products/product-builder";
import { Badge, PageHeader } from "@/components/admin/ui";
import { humanize } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { getProductForEdit, getProductFormOptions } from "@/server/admin/products.service";

export const metadata: Metadata = { title: "Edit product" };

const STATUS_TONE = { ACTIVE: "success", DRAFT: "warning", ARCHIVED: "neutral" } as const;

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  await requireAdminPage("catalog:write", `/admin/products/${id}`);
  const [product, options, query] = await Promise.all([getProductForEdit(id), getProductFormOptions(), searchParams]);
  if (!product) notFound();

  return (
    <>
      <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Products
      </Link>
      <PageHeader title={product.values.name} description={`/products/${product.slug}`}>
        <div className="mt-2">
          <Badge tone={STATUS_TONE[product.values.status]}>{humanize(product.values.status)}</Badge>
        </div>
      </PageHeader>
      {query.created === "1" && (
        <p role="status" className="mb-5 rounded-[var(--radius-card)] border border-success/30 bg-[#e6f4ea] px-4 py-3 text-sm text-success">
          Product created. Opening stock has been recorded in the movements log.
        </p>
      )}
      {/* key: a save that changes the variant set re-mounts the builder with fresh server state. */}
      <ProductBuilder key={product.values.variants.map((variant) => variant.id).join(",")} options={options} initial={product} />
    </>
  );
}
