import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog/catalog-view";
import { searchCatalog } from "@/server/catalog/catalog.service";
import { parseCatalogFilters } from "@/server/catalog/catalog-query";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: typeof q === "string" && q ? `Search: ${q}` : "Catalog" };
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseCatalogFilters(await searchParams);
  const result = await searchCatalog(null, filters);
  if (!result) notFound();
  return <CatalogView result={result} title="Catalog" crumbs={[{ label: "Home", href: "/" }, { label: "Catalog" }]} />;
}
