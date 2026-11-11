import Link from "next/link";
import type { HomeShowcase, Showcase } from "@/server/catalog/merchandising";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/shared/product-image";
import { Button } from "@/components/ui/button";

type Copy = { titleLight: string; titleBold: string; text: string };

function Title({ copy, className }: { copy: Copy; className?: string }) {
  return (
    <h3 className={cn("tracking-[-0.01em]", className)}>
      <span className="font-light">{copy.titleLight} </span>
      <span className="font-semibold">{copy.titleBold}</span>
    </h3>
  );
}

/**
 * Asymmetric 4-card bento (full-bleed on desktop):
 *   left top    wide white card (console)
 *   left bottom two halves: #EDEDED audio + #353535 VR
 *   right       full-height #EDEDED laptop card with "Shop Now"
 */
export function BentoGrid({ bento }: { bento: HomeShowcase["bento"] }) {
  const { wide, audio, vr, laptop } = bento;
  return (
    <section aria-label="Featured hardware" className="grid lg:grid-cols-2">
      <div className="grid lg:grid-rows-[328px_272px]">
        {wide && <WideCard item={wide} />}
        <div className="grid sm:grid-cols-2">
          {audio && <HalfCard item={audio} tone="light" />}
          {vr && <HalfCard item={vr} tone="dark" />}
        </div>
      </div>
      {laptop && (
        <Link
          href={`/products/${laptop.card.slug}`}
          className="group relative flex flex-col items-center overflow-hidden bg-surface-2 px-6 py-10 text-center lg:flex-row lg:items-center lg:pl-14 lg:text-left"
        >
          <div className="relative z-10 order-2 lg:order-1 lg:max-w-[360px]">
            <Title copy={laptop.copy} className="text-[34px] leading-tight lg:text-[64px] lg:leading-[1.05]" />
            <p className="mt-4 text-sm leading-6 text-muted lg:text-base">{laptop.copy.text}</p>
            <Button asChild variant="outline" size="lg" className="mt-8 lg:mt-12">
              <span>Shop Now</span>
            </Button>
          </div>
          <div className="relative order-1 h-[200px] w-[300px] transition-transform duration-500 group-hover:scale-[1.03] lg:absolute lg:-right-24 lg:top-1/2 lg:order-2 lg:h-[500px] lg:w-[460px] lg:-translate-y-1/2">
            <ProductImage src={laptop.card.imageUrl} alt={laptop.card.name} sizes="(min-width: 1024px) 460px, 300px" />
          </div>
        </Link>
      )}
    </section>
  );
}

function WideCard({ item }: { item: Showcase<Copy & { slug: string }> }) {
  return (
    <Link href={`/products/${item.card.slug}`} className="group relative flex flex-col items-center overflow-hidden bg-white px-6 py-10 text-center sm:flex-row sm:py-0 sm:text-left">
      <div className="relative h-[200px] w-[200px] shrink-0 transition-transform duration-500 group-hover:scale-[1.03] sm:-ml-16 sm:h-[328px] sm:w-[360px]">
        <ProductImage src={item.card.imageUrl} alt={item.card.name} sizes="360px" />
      </div>
      <div className="mt-4 sm:ml-2 sm:mt-0 sm:max-w-[338px] sm:pr-10">
        <Title copy={item.copy} className="text-[34px] leading-tight sm:text-[49px]" />
        <p className="mt-4 text-sm leading-6 text-muted">{item.copy.text}</p>
      </div>
    </Link>
  );
}

function HalfCard({ item, tone }: { item: Showcase<Copy & { slug: string }>; tone: "light" | "dark" }) {
  return (
    <Link
      href={`/products/${item.card.slug}`}
      className={cn(
        "group relative flex flex-col items-center overflow-hidden px-6 py-10 text-center sm:flex-row sm:py-0 sm:pl-0 sm:pr-8 sm:text-left",
        tone === "light" ? "bg-surface-2" : "bg-promo text-white",
      )}
    >
      <div className="relative h-[160px] w-[160px] shrink-0 transition-transform duration-500 group-hover:scale-[1.04] sm:-ml-10 sm:h-[272px] sm:w-[200px]">
        <ProductImage src={item.card.imageUrl} alt={item.card.name} sizes="200px" />
      </div>
      <div className="mt-4 sm:ml-2 sm:mt-0">
        <Title copy={item.copy} className="text-[29px] leading-tight" />
        <p className="mt-2.5 text-sm leading-6 text-muted">{item.copy.text}</p>
      </div>
    </Link>
  );
}
