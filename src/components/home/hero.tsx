import { HERO_BRAND } from "@/server/catalog/merchandising";
import { HeroStage } from "./hero-stage";

/** #211C24 flagship hero: brand typography left, the hardware on a lit 3D studio stage right. */
export function Hero() {
  return <HeroStage copy={HERO_BRAND.copy} cta={HERO_BRAND.cta} image={HERO_BRAND.image} />;
}
