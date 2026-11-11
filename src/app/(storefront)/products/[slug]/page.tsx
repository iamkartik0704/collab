import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductExperience } from "@/components/product/product-experience";
import { ReviewsSection } from "@/components/product/reviews-section";
import { SpecTable } from "@/components/product/spec-table";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { getProductDetail, getRatingBreakdown, getVariantAvailability } from "@/server/catalog/catalog.service";

type Params = Promise<{ slug: string }>;

function validSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,160}$/.test(slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = validSlug(slug) ? await getProductDetail(slug) : null;
  if (!product) return { title: "Product not found" };
  return {
    title: product.name,
    description: product.summary ?? product.description.slice(0, 160),
    openGraph: { images: product.images[0] ? [product.images[0].url] : [] },
  };
}

export default async function ProductPage({ params, searchParams }: { params: Params; searchParams: Promise<{ variant?: string }> }) {
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const product = await getProductDetail(slug);
  if (!product) notFound();
  // Stock and rating distribution are always live; the rest comes from the product cache.
  const [availability, breakdown, { variant }] = await Promise.all([getVariantAvailability(product.id), getRatingBreakdown(product.id), searchParams]);

  return (
    <>
      <div className="container-site">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Catalog", href: "/catalog" },
            { label: product.category.name, href: `/catalog/${product.category.slug}` },
            { label: product.brand.name, href: `/catalog/${product.category.slug}?brand=${product.brand.slug}` },
            { label: product.name },
          ]}
        />
        <div className="pb-16">
          <ProductExperience product={product} availability={availability} initialVariantId={typeof variant === "string" ? variant : null} />
        </div>
      </div>
      <div className="bg-tint-1 py-14 lg:py-20">
        <div className="container-site">
          <SpecTable specs={product.specs} description={product.description} />
        </div>
      </div>
      <div className="container-site">
        <ReviewsSection slug={product.slug} productName={product.name} breakdown={breakdown} />
      </div>
    </>
  );
}
