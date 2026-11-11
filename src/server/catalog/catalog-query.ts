import { parseStorageSlug } from "@/lib/utils";
import type { CatalogSort } from "@/types/catalog";

/**
 * URL <-> filter state for /catalog. Canonical form:
 *   ?q=pro&brand=apple,samsung&storage=256gb&ram=8gb&min=20000&max=90000&spec_screen=6.7%22&sort=price_asc&page=2&deals=1
 * Prices in the URL are whole rupees for readability; internally minor units.
 */

export const CATALOG_PAGE_SIZE = 12;
const SORTS: readonly CatalogSort[] = ["rating", "price_asc", "price_desc", "newest"];

export interface CatalogFilters {
  q: string | null;
  page: number;
  sort: CatalogSort;
  brands: string[];
  storage: number[];
  ram: number[];
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  specs: Record<string, string[]>;
  dealsOnly: boolean;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function list(value: string | string[] | undefined, max = 20): string[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return [...new Set(raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0 && part.length <= 60))].slice(0, max);
}

function rupees(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  return Number(value) * 100;
}

export function parseCatalogFilters(params: RawParams): CatalogFilters {
  const page = Number(first(params.page));
  const sort = first(params.sort) as CatalogSort | undefined;
  const q = first(params.q)?.trim().slice(0, 80) || null;
  const specs: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith("spec_") && /^spec_[a-z0-9-]{1,40}$/.test(key)) {
      const values = list(value);
      if (values.length) specs[key.slice(5)] = values;
    }
  }
  return {
    q,
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
    sort: sort && SORTS.includes(sort) ? sort : "rating",
    brands: list(params.brand).map((brand) => brand.toLowerCase()),
    storage: list(params.storage).map(parseStorageSlug).filter((gb): gb is number => gb !== null),
    ram: list(params.ram).map(parseStorageSlug).filter((gb): gb is number => gb !== null),
    minPriceMinor: rupees(first(params.min)),
    maxPriceMinor: rupees(first(params.max)),
    specs,
    dealsOnly: first(params.deals) === "1",
  };
}
