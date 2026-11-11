import Link from "next/link";
import type { HomeShowcase } from "@/server/catalog/merchandising";
import { ProductImage } from "@/components/shared/product-image";
import { Button } from "@/components/ui/button";

/** #211C24 split hero: typography left, flagship hardware cutout right. */
export function Hero({ hero }: { hero: HomeShowcase["hero"] }) {
  if (!hero) return null;
  const { card, copy } = hero;
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden bg-hero text-white">
      <div className="container-site grid items-center gap-8 pt-16 md:grid-cols-[1fr_auto] md:pt-0 lg:min-h-[632px]">
        <div className="order-2 pb-16 text-center md:order-1 md:pb-0 md:text-left">
          <p className="text-lg font-semibold text-white/40 md:text-2xl">{copy.eyebrow}</p>
          <h1 id="hero-title" className="mt-4 text-[56px] leading-[1.05] tracking-[-0.02em] md:mt-6 md:text-8xl">
            <span className="font-extralight">{copy.titleLight} </span>
            <span className="font-semibold">{copy.titleBold}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-[440px] text-base font-medium text-muted md:mx-0 md:mt-6 md:text-lg">{copy.subtitle}</p>
          <Button asChild variant="outline-light" size="lg" className="mt-8 md:mt-[46px]">
            <Link href={`/products/${card.slug}`}>Shop Now</Link>
          </Button>
        </div>
        <div className="relative order-1 mx-auto h-[300px] w-[240px] md:order-2 md:h-[632px] md:w-[406px]">
          <ProductImage src={card.imageUrl} alt={card.name} sizes="(min-width: 768px) 406px, 240px" priority className="object-bottom md:translate-y-8" />
        </div>
      </div>
    </section>
  );
}
