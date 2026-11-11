import { z } from "zod";
import { db } from "@/lib/db";
import { resolveImageUrl } from "@/lib/images";
import { cached, CacheKeys, CachePolicies, CacheTags, hashedCacheKey } from "@/lib/redis";
import { storageLabel, storageSlug } from "@/lib/utils";
import type {
  CatalogResult,
  CategoryLink,
  Facet,
  FacetOption,
  HighlightSpec,
  ProductCardData,
  ProductDetail,
  RatingBreakdown,
  ReviewView,
  SearchSuggestion,
} from "@/types/catalog";
import { CARD_SELECT, toProductCard } from "./card";
import { CATALOG_PAGE_SIZE, type CatalogFilters } from "./catalog-query";

// ============================================================================ categories

export async function getNavigationCategories(): Promise<CategoryLink[]> {
  return cached(
    hashedCacheKey("nav", { v: 1 }),
    async () =>
      db.category.findMany({
        where: { isActive: true, parentId: null },
        orderBy: { sortOrder: "asc" },
        select: { slug: true, name: true, iconKey: true },
      }),
    { ...CachePolicies.home, tags: [CacheTags.catalog()] },
  );
}

// ============================================================================ catalog dataset

const specTemplateSchema = z.object({
  facets: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string(), group: z.string(), field: z.string() }))
    .default([]),
});

interface CatalogEntry {
  card: ProductCardData;
  brandSlug: string;
  brandName: string;
  publishedAt: number;
  salesCount: number;
  storage: number[];
  ram: number[];
  specs: Record<string, string>;
  searchText: string;
  isDeal: boolean;
}

interface CatalogDataset {
  category: CategoryLink | null;
  specFacets: Array<{ key: string; label: string }>;
  entries: CatalogEntry[];
}

function specValue(specs: unknown, group: string, field: string): string | null {
  if (!specs || typeof specs !== "object") return null;
  const section = (specs as Record<string, unknown>)[group];
  if (!section || typeof section !== "object") return null;
  const value = (section as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function loadDataset(categorySlug: string | null): Promise<CatalogDataset | null> {
  return cached(
    CacheKeys.catalog({ dataset: categorySlug ?? "*", v: 1 }),
    async (): Promise<CatalogDataset | null> => {
      const category = categorySlug
        ? await db.category.findFirst({ where: { slug: categorySlug, isActive: true }, select: { id: true, slug: true, name: true, iconKey: true, specTemplate: true } })
        : null;
      if (categorySlug && !category) return null;

      const template = category ? specTemplateSchema.safeParse(category.specTemplate ?? {}) : null;
      const facetDefs = template?.success ? template.data.facets : [];

      const products = await db.product.findMany({
        where: { status: "ACTIVE", deletedAt: null, ...(category ? { categoryId: category.id } : {}) },
        select: {
          ...CARD_SELECT,
          specs: true,
          salesCount: true,
          publishedAt: true,
          createdAt: true,
          brand: { select: { slug: true, name: true } },
          category: { select: { name: true } },
        },
      });

      const entries: CatalogEntry[] = [];
      for (const product of products) {
        const card = toProductCard(product);
        if (!card) continue;
        const specs: Record<string, string> = {};
        for (const facet of facetDefs) {
          const value = specValue(product.specs, facet.group, facet.field);
          if (value) specs[facet.key] = value;
        }
        entries.push({
          card,
          brandSlug: product.brand.slug,
          brandName: product.brand.name,
          publishedAt: (product.publishedAt ?? product.createdAt).getTime(),
          salesCount: product.salesCount,
          storage: [...new Set(product.variants.map((v) => v.storageGb).filter((v): v is number => v !== null))],
          ram: [...new Set(product.variants.map((v) => v.ramGb).filter((v): v is number => v !== null))],
          specs,
          searchText: `${product.name} ${product.brand.name} ${product.category.name}`.toLowerCase(),
          isDeal: card.compareAtPriceMinor !== null && card.compareAtPriceMinor > card.priceMinor,
        });
      }

      return {
        category: category ? { slug: category.slug, name: category.name, iconKey: category.iconKey } : null,
        specFacets: facetDefs.map(({ key, label }) => ({ key, label })),
        entries,
      };
    },
    { ...CachePolicies.catalog, tags: [CacheTags.catalog(), ...(categorySlug ? [CacheTags.category(categorySlug)] : [])] },
  );
}

type FacetKey = "brand" | "storage" | "ram" | `spec:${string}` | "price";

function matches(entry: CatalogEntry, filters: CatalogFilters, exclude?: FacetKey): boolean {
  if (filters.dealsOnly && !entry.isDeal) return false;
  if (filters.q) {
    const tokens = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.every((token) => entry.searchText.includes(token))) return false;
  }
  if (exclude !== "brand" && filters.brands.length && !filters.brands.includes(entry.brandSlug)) return false;
  if (exclude !== "storage" && filters.storage.length && !entry.storage.some((gb) => filters.storage.includes(gb))) return false;
  if (exclude !== "ram" && filters.ram.length && !entry.ram.some((gb) => filters.ram.includes(gb))) return false;
  if (exclude !== "price") {
    if (filters.minPriceMinor !== null && entry.card.priceMinor < filters.minPriceMinor) return false;
    if (filters.maxPriceMinor !== null && entry.card.priceMinor > filters.maxPriceMinor) return false;
  }
  for (const [key, values] of Object.entries(filters.specs)) {
    if (exclude === `spec:${key}`) continue;
    const value = entry.specs[key];
    if (!value || !values.includes(value)) return false;
  }
  return true;
}

const SORTERS: Record<CatalogFilters["sort"], (a: CatalogEntry, b: CatalogEntry) => number> = {
  rating: (a, b) => b.card.ratingAverage - a.card.ratingAverage || b.card.ratingCount - a.card.ratingCount || b.salesCount - a.salesCount,
  price_asc: (a, b) => a.card.priceMinor - b.card.priceMinor,
  price_desc: (a, b) => b.card.priceMinor - a.card.priceMinor,
  newest: (a, b) => b.publishedAt - a.publishedAt,
};

function countBy<T extends string | number>(entries: CatalogEntry[], pick: (entry: CatalogEntry) => T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const entry of entries) {
    for (const value of new Set(pick(entry))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function options<T extends string | number>(
  counts: Map<T, number>,
  selected: readonly T[],
  toValue: (key: T) => string,
  toLabel: (key: T) => string,
  order: (a: T, b: T) => number,
): FacetOption[] {
  const keys = new Set<T>([...counts.keys(), ...selected]);
  return [...keys].sort(order).map((key) => ({
    value: toValue(key),
    label: toLabel(key),
    count: counts.get(key) ?? 0,
    selected: selected.includes(key),
  }));
}

const naturalOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Filtered, sorted, paginated listing with live (disjunctive) facet counts. */
export async function searchCatalog(categorySlug: string | null, filters: CatalogFilters): Promise<CatalogResult | null> {
  const dataset = await loadDataset(categorySlug);
  if (!dataset) return null;
  const { entries } = dataset;

  const results = entries.filter((entry) => matches(entry, filters)).sort((a, b) => SORTERS[filters.sort](a, b) || a.card.name.localeCompare(b.card.name));
  const pageCount = Math.max(1, Math.ceil(results.length / CATALOG_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const brandNames = new Map(entries.map((entry) => [entry.brandSlug, entry.brandName]));
  const facets: Facet[] = [
    {
      key: "brand",
      label: "Brand",
      options: options(
        countBy(entries.filter((e) => matches(e, filters, "brand")), (e) => [e.brandSlug]),
        filters.brands,
        (slug) => slug,
        (slug) => brandNames.get(slug) ?? slug,
        (a, b) => (brandNames.get(a) ?? a).localeCompare(brandNames.get(b) ?? b),
      ),
    },
    {
      key: "storage",
      label: "Built-in memory",
      options: options(countBy(entries.filter((e) => matches(e, filters, "storage")), (e) => e.storage), filters.storage, storageSlug, storageLabel, (a, b) => a - b),
    },
    {
      key: "ram",
      label: "RAM",
      options: options(countBy(entries.filter((e) => matches(e, filters, "ram")), (e) => e.ram), filters.ram, storageSlug, storageLabel, (a, b) => a - b),
    },
    ...dataset.specFacets.map((facet) => ({
      key: `spec_${facet.key}`,
      label: facet.label,
      options: options(
        countBy(entries.filter((e) => matches(e, filters, `spec:${facet.key}`)), (e) => (e.specs[facet.key] ? [e.specs[facet.key]!] : [])),
        filters.specs[facet.key] ?? [],
        (value) => value,
        (value) => value,
        naturalOrder,
      ),
    })),
  ].filter((facet) => facet.options.length > 0);

  const prices = entries.filter((e) => matches(e, filters, "price")).map((e) => e.card.priceMinor);
  const allPrices = entries.map((e) => e.card.priceMinor);
  const boundsSource = prices.length ? prices : allPrices;

  return {
    products: results.slice((page - 1) * CATALOG_PAGE_SIZE, page * CATALOG_PAGE_SIZE).map((entry) => entry.card),
    total: results.length,
    page,
    pageCount,
    pageSize: CATALOG_PAGE_SIZE,
    sort: filters.sort,
    facets,
    price: {
      boundsMin: boundsSource.length ? Math.floor(Math.min(...boundsSource) / 100_00) * 100_00 : 0,
      boundsMax: boundsSource.length ? Math.ceil(Math.max(...boundsSource) / 100_00) * 100_00 : 0,
      selectedMin: filters.minPriceMinor,
      selectedMax: filters.maxPriceMinor,
    },
    category: dataset.category,
    query: filters.q,
    dealsOnly: filters.dealsOnly,
  };
}

// ============================================================================ home

export async function getProductCardsBySlugs(slugs: readonly string[]): Promise<Map<string, ProductCardData>> {
  const products = await db.product.findMany({ where: { slug: { in: [...slugs] }, status: "ACTIVE", deletedAt: null }, select: CARD_SELECT });
  const cards = new Map<string, ProductCardData>();
  for (const product of products) {
    const card = toProductCard(product);
    if (card) cards.set(product.slug, card);
  }
  return cards;
}

export async function getProductCardsByIds(ids: readonly string[]): Promise<ProductCardData[]> {
  const products = await db.product.findMany({ where: { id: { in: [...ids] }, status: "ACTIVE", deletedAt: null }, select: CARD_SELECT });
  const order = new Map(ids.map((id, index) => [id, index]));
  return products
    .map(toProductCard)
    .filter((card): card is ProductCardData => card !== null)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export interface HomeTabs {
  newArrival: ProductCardData[];
  bestseller: ProductCardData[];
  featured: ProductCardData[];
  discounts: ProductCardData[];
}

/** collab:home:tabs - product tabs and the discounts row (10 min + SWR). */
export async function getHomeTabs(): Promise<HomeTabs> {
  return cached(
    CacheKeys.homeTabs(),
    async () => {
      const active = { status: "ACTIVE" as const, deletedAt: null };
      const [newArrival, bestseller, featured, discountPool] = await Promise.all([
        db.product.findMany({ where: active, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 8, select: CARD_SELECT }),
        db.product.findMany({ where: active, orderBy: [{ salesCount: "desc" }, { ratingCount: "desc" }], take: 8, select: CARD_SELECT }),
        db.product.findMany({ where: { ...active, isFeatured: true }, orderBy: { ratingAverage: "desc" }, take: 8, select: CARD_SELECT }),
        db.product.findMany({
          where: { ...active, variants: { some: { isActive: true, compareAtPriceMinor: { not: null } } } },
          select: CARD_SELECT,
          take: 40,
        }),
      ]);
      const toCards = (rows: typeof newArrival) => rows.map(toProductCard).filter((card): card is ProductCardData => card !== null);
      const discounts = toCards(discountPool)
        .filter((card) => card.compareAtPriceMinor !== null && card.compareAtPriceMinor > card.priceMinor)
        .sort((a, b) => (b.compareAtPriceMinor! - b.priceMinor) / b.compareAtPriceMinor! - (a.compareAtPriceMinor! - a.priceMinor) / a.compareAtPriceMinor!)
        .slice(0, 4);
      return { newArrival: toCards(newArrival), bestseller: toCards(bestseller), featured: toCards(featured), discounts };
    },
    { ...CachePolicies.home, tags: [CacheTags.home(), CacheTags.catalog()] },
  );
}

// ============================================================================ product detail

const highlightSchema = z.array(
  z.object({
    icon: z.enum(["screen", "cpu", "cores", "camera", "front-camera", "battery", "storage", "weight", "display"]),
    label: z.string(),
    value: z.string(),
  }),
);

/** collab:product:{slug} - everything on the product page except live stock and reviews. */
export async function getProductDetail(slug: string): Promise<ProductDetail | null> {
  const productId = await db.product.findFirst({ where: { slug, status: "ACTIVE", deletedAt: null }, select: { id: true } });
  if (!productId) return null;
  return cached(
    CacheKeys.product(slug),
    async (): Promise<ProductDetail | null> => {
      const product = await db.product.findFirst({
        where: { slug, status: "ACTIVE", deletedAt: null },
        include: {
          brand: { select: { slug: true, name: true } },
          category: { select: { slug: true, name: true } },
          images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], include: { variant: { select: { color: true } } } },
          variants: { where: { isActive: true, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { priceMinor: "asc" }] },
        },
      });
      if (!product || product.variants.length === 0) return null;
      const highlights = highlightSchema.safeParse(product.highlightSpecs);
      const specs: Record<string, Record<string, string>> = {};
      if (product.specs && typeof product.specs === "object" && !Array.isArray(product.specs)) {
        for (const [group, fields] of Object.entries(product.specs as Record<string, unknown>)) {
          if (fields && typeof fields === "object" && !Array.isArray(fields)) {
            specs[group] = Object.fromEntries(Object.entries(fields as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
          }
        }
      }
      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        subtitle: product.subtitle,
        summary: product.summary,
        description: product.description,
        brand: product.brand,
        category: product.category,
        specs,
        highlightSpecs: highlights.success ? (highlights.data as HighlightSpec[]) : [],
        warrantyMonths: product.warrantyMonths,
        ratingAverage: product.ratingAverage,
        ratingCount: product.ratingCount,
        images: product.images.map((image) => ({
          url: resolveImageUrl(image.storageKey)!,
          alt: image.alt,
          variantId: image.variantId,
          color: image.variant?.color ?? null,
        })),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          title: variant.title,
          color: variant.color,
          colorHex: variant.colorHex,
          storageGb: variant.storageGb,
          ramGb: variant.ramGb,
          priceMinor: variant.priceMinor,
          compareAtPriceMinor: variant.compareAtPriceMinor,
          currency: variant.currency,
          isDefault: variant.isDefault,
        })),
      };
    },
    { ...CachePolicies.product, tags: [CacheTags.product(productId.id)] },
  );
}

/** Live (uncached) stock per variant - the product page must never show stale availability. */
export async function getVariantAvailability(productId: string): Promise<Record<string, number>> {
  const rows = await db.inventoryItem.findMany({
    where: { variant: { productId } },
    select: { variantId: true, quantityAvailable: true },
  });
  return Object.fromEntries(rows.map((row) => [row.variantId, row.quantityAvailable]));
}

export async function getRatingBreakdown(productId: string): Promise<RatingBreakdown> {
  const groups = await db.review.groupBy({
    by: ["rating"],
    where: { productId, status: "APPROVED" },
    _count: { _all: true },
  });
  const counts: RatingBreakdown["counts"] = [0, 0, 0, 0, 0];
  let total = 0;
  let sum = 0;
  for (const group of groups) {
    const index = 5 - group.rating;
    if (index >= 0 && index < 5) {
      counts[index] = group._count._all;
      total += group._count._all;
      sum += group.rating * group._count._all;
    }
  }
  return { average: total ? Math.round((sum / total) * 10) / 10 : 0, total, counts };
}

export const REVIEWS_PAGE_SIZE = 5;

export async function getReviews(productId: string, page: number): Promise<{ reviews: ReviewView[]; page: number; pageCount: number; total: number }> {
  const where = { productId, status: "APPROVED" as const };
  const total = await db.review.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / REVIEWS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = await db.review.findMany({
    where,
    orderBy: [{ isVerifiedPurchase: "desc" }, { createdAt: "desc" }],
    skip: (current - 1) * REVIEWS_PAGE_SIZE,
    take: REVIEWS_PAGE_SIZE,
    select: { id: true, rating: true, title: true, body: true, isVerifiedPurchase: true, createdAt: true, user: { select: { name: true, email: true } } },
  });
  return {
    total,
    page: current,
    pageCount,
    reviews: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      author: displayName(row.user.name, row.user.email),
      isVerifiedPurchase: row.isVerifiedPurchase,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** "Priya Sharma" -> "Priya S."; falls back to the email's local part. Never exposes the email. */
function displayName(name: string | null, email: string | null): string {
  if (name?.trim()) {
    const [given, ...rest] = name.trim().split(/\s+/);
    const initial = rest.at(-1)?.[0];
    return initial ? `${given} ${initial.toUpperCase()}.` : given!;
  }
  const local = email?.split("@")[0] ?? "Customer";
  return `${local.slice(0, 1).toUpperCase()}${local.slice(1, 3)}***`;
}

// ============================================================================ search suggestions

export async function getSearchSuggestions(query: string): Promise<SearchSuggestion> {
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return { products: [], categories: [] };
  return cached(
    hashedCacheKey("suggest", { q: q.toLowerCase() }),
    async () => {
      const [products, categories] = await Promise.all([
        db.product.findMany({
          where: {
            status: "ACTIVE",
            deletedAt: null,
            OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { name: { contains: q, mode: "insensitive" } } }],
          },
          orderBy: [{ salesCount: "desc" }, { ratingCount: "desc" }],
          take: 6,
          select: CARD_SELECT,
        }),
        db.category.findMany({
          where: { isActive: true, name: { contains: q, mode: "insensitive" } },
          take: 3,
          select: { slug: true, name: true },
        }),
      ]);
      return {
        products: products
          .map(toProductCard)
          .filter((card): card is ProductCardData => card !== null)
          .map((card) => ({ slug: card.slug, name: card.name, imageUrl: card.imageUrl, priceMinor: card.priceMinor, currency: card.currency })),
        categories,
      };
    },
    { ttlSeconds: 120, staleWhileRevalidateSeconds: 60, tags: [CacheTags.catalog()] },
  );
}
