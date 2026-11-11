/** View models shared by server data loaders and client components (no server imports). */

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  defaultVariantId: string;
  inStock: boolean;
  ratingAverage: number;
  ratingCount: number;
}

export interface CategoryLink {
  slug: string;
  name: string;
  iconKey: string | null;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface Facet {
  key: string;
  label: string;
  options: FacetOption[];
}

export type CatalogSort = "rating" | "price_asc" | "price_desc" | "newest";

export interface CatalogResult {
  products: ProductCardData[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: CatalogSort;
  facets: Facet[];
  price: { boundsMin: number; boundsMax: number; selectedMin: number | null; selectedMax: number | null };
  category: CategoryLink | null;
  query: string | null;
  dealsOnly: boolean;
}

export interface VariantOption {
  id: string;
  sku: string;
  title: string;
  color: string | null;
  colorHex: string | null;
  storageGb: number | null;
  ramGb: number | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  isDefault: boolean;
}

export interface GalleryImage {
  url: string;
  alt: string;
  variantId: string | null;
  /** Colour of the linked variant: the gallery shows a colour's images for all its variants. */
  color: string | null;
}

export interface HighlightSpec {
  icon: "screen" | "cpu" | "cores" | "camera" | "front-camera" | "battery" | "storage" | "weight" | "display";
  label: string;
  value: string;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  summary: string | null;
  description: string;
  brand: { slug: string; name: string };
  category: { slug: string; name: string };
  specs: Record<string, Record<string, string>>;
  highlightSpecs: HighlightSpec[];
  warrantyMonths: number;
  ratingAverage: number;
  ratingCount: number;
  images: GalleryImage[];
  variants: VariantOption[];
}

export interface RatingBreakdown {
  average: number;
  total: number;
  /** Index 0 = 5 stars ... index 4 = 1 star. */
  counts: [number, number, number, number, number];
}

export interface ReviewView {
  id: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  isVerifiedPurchase: boolean;
  createdAt: string;
}

export interface SearchSuggestion {
  products: Array<{ slug: string; name: string; imageUrl: string | null; priceMinor: number; currency: string }>;
  categories: Array<{ slug: string; name: string }>;
}
