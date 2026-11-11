import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductBuilder } from "@/components/admin/products/product-builder";
import { PageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { getProductFormOptions } from "@/server/admin/products.service";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requireAdminPage("catalog:write", "/admin/products/new");
  const options = await getProductFormOptions();
  return (
    <>
      <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Products
      </Link>
      <PageHeader title="New product" description="Define the product, its colour / storage / RAM options and the SKU matrix. Opening stock is recorded as a restock movement." />
      <ProductBuilder options={options} initial={null} />
    </>
  );
}
