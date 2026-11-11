import { BentoGrid } from "@/components/home/bento-grid";
import { CategoryCarousel } from "@/components/home/category-carousel";
import { FeatureStrip } from "@/components/home/feature-strip";
import { Hero } from "@/components/home/hero";
import { ProductTabs } from "@/components/home/product-tabs";
import { SaleBanner } from "@/components/home/sale-banner";
import { ProductGrid } from "@/components/product/product-card";
import { getHomeTabs, getNavigationCategories } from "@/server/catalog/catalog.service";
import { getHomeShowcase } from "@/server/catalog/merchandising";

/** Home: every block reads from Redis-cached aggregations (collab:home:bento / :tabs). */
export default async function HomePage() {
  const [showcase, tabs, categories] = await Promise.all([getHomeShowcase(), getHomeTabs(), getNavigationCategories()]);

  return (
    <>
      <Hero hero={showcase.hero} />
      <BentoGrid bento={showcase.bento} />
      <div className="bg-tint-1">
        <CategoryCarousel categories={categories} />
      </div>
      <ProductTabs tabs={{ new: tabs.newArrival, bestseller: tabs.bestseller, featured: tabs.featured }} />
      <FeatureStrip items={showcase.featureStrip} />
      {tabs.discounts.length > 0 && (
        <section aria-labelledby="discounts-title" className="container-site py-14">
          <h2 id="discounts-title" className="mb-8 text-2xl font-medium">
            Discounts up to -50%
          </h2>
          <ProductGrid products={tabs.discounts} showDiscount />
        </section>
      )}
      <SaleBanner art={showcase.saleArt} />
    </>
  );
}
