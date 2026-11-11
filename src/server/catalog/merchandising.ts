import { cached, CacheKeys, CachePolicies, CacheTags } from "@/lib/redis";
import type { ProductCardData } from "@/types/catalog";
import { getProductCardsBySlugs } from "./catalog.service";

/**
 * Home-page merchandising: which products fill the hero, bento grid, feature strip and sale
 * banner, with their marketing copy. Missing or inactive products simply drop out.
 */
/**
 * Flagship brand hero (static, not a catalogue product). The cutout and its alpha mask live in
 * public/images/hero/; replace them (same file names, any size) to change the hero hardware.
 */
export const HERO_BRAND = {
  copy: {
    eyebrow: "Pro.Beyond.",
    titleLight: "Made by",
    titleBold: "Collab",
    subtitle: "Created to change everything for the better. For everyone",
    backdrop: "Pro.Beyond.",
  },
  cta: { label: "Shop Now", href: "/catalog" },
  image: { src: "/images/hero/collab-kettle.png", mask: "/images/hero/collab-kettle-mask.png", alt: "Collab electric kettle in matte black", width: 903, height: 974 },
} as const;

export const HOME_MERCHANDISING = {
  bento: {
    wide: {
      slug: "playstation-5",
      titleLight: "Playstation",
      titleBold: "5",
      text: "Incredibly powerful CPUs, GPUs, and an SSD with integrated I/O will redefine your PlayStation experience.",
    },
    audio: { slug: "airpods-max", titleLight: "Apple AirPods", titleBold: "Max", text: "Computational audio. Listen, it's powerful" },
    vr: { slug: "apple-vision-pro", titleLight: "Apple Vision", titleBold: "Pro", text: "An immersive way to experience entertainment" },
    laptop: {
      slug: "macbook-air-15",
      titleLight: "Macbook",
      titleBold: "Air",
      text: "The new 15‑inch MacBook Air makes room for more of what you love with a spacious Liquid Retina display.",
    },
  },
  featureStrip: [
    { slug: "airpods-pro-2", title: "Popular Products", text: "Adaptive audio, all-day comfort and a case you can find anywhere. Our best-loved accessories in one place." },
    { slug: "ipad-pro-13", title: "Ipad Pro", text: "iPad Pro combines a magnificent 13-inch Ultra Retina display with blazing M4 performance for work and play." },
    { slug: "samsung-galaxy-s24-ultra", title: "Samsung Galaxy", text: "A titanium frame, a 200MP camera and Galaxy AI built in. The most capable Galaxy yet." },
    { slug: "macbook-pro-14", title: "Macbook Pro", text: "M3 Pro power, up to 18 hours of battery and the best display ever in a laptop.", dark: true },
  ],
  saleBanner: {
    titleLight: "Big Summer",
    titleBold: "Sale",
    subtitle: "Up to 50% off flagship phones, laptops and audio. Limited stock, while it lasts.",
    href: "/deals",
    artSlugs: ["iphone-14-pro", "samsung-galaxy-z-fold-5", "apple-watch-ultra-2", "ipad-pro-13", "airpods-max"],
  },
} as const;

export interface Showcase<T> {
  card: ProductCardData;
  copy: T;
}

export interface HomeShowcase {
  bento: {
    wide: Showcase<(typeof HOME_MERCHANDISING)["bento"]["wide"]> | null;
    audio: Showcase<(typeof HOME_MERCHANDISING)["bento"]["audio"]> | null;
    vr: Showcase<(typeof HOME_MERCHANDISING)["bento"]["vr"]> | null;
    laptop: Showcase<(typeof HOME_MERCHANDISING)["bento"]["laptop"]> | null;
  };
  featureStrip: Array<Showcase<(typeof HOME_MERCHANDISING)["featureStrip"][number]>>;
  saleArt: Array<{ slug: string; imageUrl: string | null; name: string }>;
}

/** collab:home:bento - hero, bento grid, feature strip and sale-banner art (10 min + SWR). */
export async function getHomeShowcase(): Promise<HomeShowcase> {
  return cached(
    CacheKeys.homeBento(),
    async (): Promise<HomeShowcase> => {
      const m = HOME_MERCHANDISING;
      const slugs = [
        m.bento.wide.slug,
        m.bento.audio.slug,
        m.bento.vr.slug,
        m.bento.laptop.slug,
        ...m.featureStrip.map((item) => item.slug),
        ...m.saleBanner.artSlugs,
      ];
      const cards = await getProductCardsBySlugs(slugs);
      const pick = <T extends { slug: string }>(copy: T): Showcase<T> | null => {
        const card = cards.get(copy.slug);
        return card ? { card, copy } : null;
      };
      return {
        bento: { wide: pick(m.bento.wide), audio: pick(m.bento.audio), vr: pick(m.bento.vr), laptop: pick(m.bento.laptop) },
        featureStrip: m.featureStrip.map(pick).filter((item): item is NonNullable<typeof item> => item !== null),
        saleArt: m.saleBanner.artSlugs
          .map((slug) => cards.get(slug))
          .filter((card): card is ProductCardData => card !== undefined)
          .map((card) => ({ slug: card.slug, imageUrl: card.imageUrl, name: card.name })),
      };
    },
    { ...CachePolicies.home, tags: [CacheTags.home(), CacheTags.catalog()] },
  );
}
