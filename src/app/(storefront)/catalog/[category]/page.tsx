import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog/catalog-view";
import { searchCatalog } from "@/server/catalog/catalog.service";
import { parseCatalogFilters } from "@/server/catalog/catalog-query";

type Params = Promise<{ category: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function validSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,80}$/.test(slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { category } = await params;
  if (!validSlug(category)) return {};
  const result = await searchCatalog(category, parseCatalogFilters({}));
  return { title: result?.category?.name ?? "Catalog" };
}

export default async function CategoryCatalogPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { category } = await params;
  if (!validSlug(category)) notFound();
  const result = await searchCatalog(category, parseCatalogFilters(await searchParams));
  if (!result || !result.category) notFound();
  return (
    <CatalogView
      result={result}
      title={result.category.name}
      crumbs={[{ label: "Home", href: "/" }, { label: "Catalog", href: "/catalog" }, { label: result.category.name }]}
    />
  );
}
