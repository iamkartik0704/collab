import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog/catalog-view";
import { searchCatalog } from "@/server/catalog/catalog.service";
import { parseCatalogFilters } from "@/server/catalog/catalog-query";

export const metadata: Metadata = { title: "Deals" };

/** Every product currently priced below its MRP, with the full filter set. */
export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = { ...parseCatalogFilters(await searchParams), dealsOnly: true };
  const result = await searchCatalog(null, filters);
  if (!result) notFound();
  return <CatalogView result={result} title="Deals" crumbs={[{ label: "Home", href: "/" }, { label: "Deals" }]} />;
}
