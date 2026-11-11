import Image from "next/image";
import Link from "next/link";
import type { HomeShowcase } from "@/server/catalog/merchandising";
import { HOME_MERCHANDISING } from "@/server/catalog/merchandising";
import { Button } from "@/components/ui/button";

/** Positions of the floating device art (left and right edges of the banner). */
const FLOAT_SLOTS = [
  "left-[-40px] top-[-10px] h-[200px] w-[200px] -rotate-12",
  "left-[-10px] bottom-[-40px] h-[220px] w-[240px] rotate-6",
  "left-[150px] bottom-[-60px] h-[180px] w-[160px] -rotate-6",
  "right-[-20px] top-[-30px] h-[260px] w-[300px] rotate-12",
  "right-[60px] bottom-[-50px] h-[200px] w-[220px] -rotate-6",
];

export function SaleBanner({ art }: { art: HomeShowcase["saleArt"] }) {
  const copy = HOME_MERCHANDISING.saleBanner;
  return (
    <section
      aria-labelledby="sale-title"
      className="relative overflow-hidden text-white"
      style={{ background: "radial-gradient(ellipse at center, #2e2e2e 0%, #211c24 55%, #120f14 100%)" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        {art.slice(0, FLOAT_SLOTS.length).map((item, index) =>
          item.imageUrl ? (
            <div key={item.slug} className={`absolute opacity-90 ${FLOAT_SLOTS[index]}`}>
              <Image src={item.imageUrl} alt="" fill sizes="300px" unoptimized={item.imageUrl.endsWith(".svg")} className="object-contain drop-shadow-2xl" />
            </div>
          ) : null,
        )}
      </div>
      <div className="container-site relative py-28 text-center lg:py-[110px]">
        <h2 id="sale-title" className="text-5xl leading-tight tracking-[-0.02em] lg:text-7xl">
          <span className="font-extralight">{copy.titleLight} </span>
          <span className="font-semibold">{copy.titleBold}</span>
        </h2>
        <p className="mx-auto mt-4 max-w-[500px] text-base text-muted">{copy.subtitle}</p>
        <Button asChild variant="outline-light" size="lg" className="mt-10">
          <Link href={copy.href}>Shop Now</Link>
        </Button>
      </div>
    </section>
  );
}
