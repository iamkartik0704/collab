import Link from "next/link";
import type { HomeShowcase } from "@/server/catalog/merchandising";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/shared/product-image";
import { Button } from "@/components/ui/button";

const SHADES = ["bg-white", "bg-tint-1", "bg-tint-2", "bg-promo-deep text-white"] as const;

/** Four full-bleed columns graduating #FFFFFF -> #F9F9F9 -> #EAEAEA -> #2C2C2C. */
export function FeatureStrip({ items }: { items: HomeShowcase["featureStrip"] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Spotlight" className="grid sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => {
        const dark = "dark" in item.copy && item.copy.dark;
        return (
          <article key={item.card.id} className={cn("flex flex-col px-8 pb-14", SHADES[index % SHADES.length])}>
            <div className="relative mx-auto h-[300px] w-full max-w-[300px]">
              <ProductImage src={item.card.imageUrl} alt={item.card.name} sizes="300px" />
            </div>
            <h3 className="mt-4 text-[33px] font-light leading-tight">{item.copy.title}</h3>
            <p className="mt-4 flex-1 text-sm leading-6 text-muted">{item.copy.text}</p>
            <Button asChild variant={dark ? "outline-light" : "outline"} size="lg" className="mt-8 self-start">
              <Link href={`/products/${item.card.slug}`} aria-label={`Shop ${item.card.name}`}>
                Shop Now
              </Link>
            </Button>
          </article>
        );
      })}
    </section>
  );
}
