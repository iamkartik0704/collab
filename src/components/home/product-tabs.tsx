"use client";

import type { ProductCardData } from "@/types/catalog";
import { ProductGrid } from "@/components/product/product-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";

const TABS = [
  { value: "new", label: "New Arrival" },
  { value: "bestseller", label: "Bestseller" },
  { value: "featured", label: "Featured Products" },
] as const;

export function ProductTabs({ tabs }: { tabs: { new: ProductCardData[]; bestseller: ProductCardData[]; featured: ProductCardData[] } }) {
  return (
    <section aria-label="Products" className="container-site py-14">
      <Tabs defaultValue="new">
        <TabsList aria-label="Product collections" className="mb-8">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="data-[state=active]:animate-fade-in">
            {tabs[tab.value].length ? (
              <ProductGrid products={tabs[tab.value]} />
            ) : (
              <p className="py-12 text-center text-muted-2">New products are on their way.</p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
