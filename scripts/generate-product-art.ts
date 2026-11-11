import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artPath, PRODUCTS, type ArtKind } from "../prisma/catalog-data";

/**
 * Generates original SVG device illustrations (main + angled alternate view) for every
 * product colour in the demo catalogue. Output: public/images/products/*.svg
 * Run: npx tsx scripts/generate-product-art.ts
 */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

/** amount > 0 lightens towards white, < 0 darkens towards black. */
function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return toHex(rgb.map((c) => (amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))) as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

interface Palette {
  base: string;
  light: string;
  dark: string;
  darker: string;
  edge: string;
  isLight: boolean;
}

function palette(hex: string): Palette {
  const isLight = luminance(hex) > 0.72;
  return {
    base: hex,
    light: shade(hex, isLight ? 0.4 : 0.22),
    dark: shade(hex, isLight ? -0.12 : -0.28),
    darker: shade(hex, isLight ? -0.3 : -0.5),
    edge: isLight ? "#cfcfcf" : shade(hex, -0.55),
    isLight,
  };
}

const LENS = (x: number, y: number, r = 15) =>
  `<g><circle cx="${x}" cy="${y}" r="${r}" fill="#16171b"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#2c2e35" stroke-width="3"/><circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="#252a38"/><circle cx="${x - r * 0.22}" cy="${y - r * 0.22}" r="${r * 0.2}" fill="#6f84ad" opacity="0.75"/></g>`;

const WALLPAPER = (p: Palette, id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(p.base, 0.15)}"/><stop offset="0.55" stop-color="${shade(p.base, -0.35)}"/><stop offset="1" stop-color="#0d0d12"/></linearGradient>`;

const BODY_GRADIENT = (p: Palette, id = "body") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.light}"/><stop offset="0.55" stop-color="${p.base}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient>`;

const SHEEN = `<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/></linearGradient>`;

const DRAW: Record<ArtKind, (p: Palette) => { defs: string; body: string }> = {
  phone: (p) => ({
    defs: BODY_GRADIENT(p) + SHEEN,
    body: `<rect x="125" y="30" width="150" height="312" rx="31" fill="${p.edge}"/><rect x="129" y="34" width="142" height="304" rx="27" fill="url(#body)"/><rect x="138" y="44" width="76" height="78" rx="20" fill="${p.darker}" opacity="0.35"/>${LENS(158, 64)}${LENS(158, 102)}${LENS(194, 83)}<circle cx="195" cy="57" r="4" fill="#f6efd8"/><circle cx="200" cy="200" r="13" fill="${p.darker}" opacity="0.18"/><rect x="129" y="34" width="142" height="304" rx="27" fill="url(#sheen)"/>`,
  }),
  android: (p) => ({
    defs: BODY_GRADIENT(p) + SHEEN,
    body: `<rect x="122" y="28" width="156" height="318" rx="24" fill="${p.edge}"/><rect x="126" y="32" width="148" height="310" rx="21" fill="url(#body)"/>${LENS(156, 70, 14)}${LENS(156, 108, 14)}${LENS(156, 146, 14)}<circle cx="186" cy="70" r="4" fill="#f6efd8"/><rect x="126" y="32" width="148" height="310" rx="21" fill="url(#sheen)"/>`,
  }),
  foldable: (p) => ({
    defs: WALLPAPER(p, "wall") + SHEEN,
    body: `<rect x="86" y="56" width="228" height="290" rx="20" fill="${p.edge}"/><rect x="90" y="60" width="220" height="282" rx="17" fill="${p.base}"/><rect x="97" y="67" width="206" height="268" rx="12" fill="url(#wall)"/><line x1="200" y1="67" x2="200" y2="335" stroke="#000" stroke-opacity="0.35" stroke-width="2"/><circle cx="250" cy="82" r="4" fill="#111"/><rect x="97" y="67" width="206" height="268" rx="12" fill="url(#sheen)"/>`,
  }),
  laptop: (p) => ({
    defs: WALLPAPER(p, "wall") + BODY_GRADIENT(p, "base"),
    body: `<rect x="58" y="72" width="284" height="190" rx="12" fill="${p.edge}"/><rect x="61" y="75" width="278" height="184" rx="10" fill="#0e0e10"/><rect x="69" y="83" width="262" height="168" rx="5" fill="url(#wall)"/><rect x="186" y="75" width="28" height="7" rx="3" fill="#0e0e10"/><path d="M30 262 L370 262 L358 282 Q356 286 350 286 L50 286 Q44 286 42 282 Z" fill="url(#base)"/><rect x="170" y="262" width="60" height="5" rx="2" fill="${p.darker}" opacity="0.6"/>`,
  }),
  desktop: (p) => ({
    defs: WALLPAPER(p, "wall") + BODY_GRADIENT(p, "chin"),
    body: `<path d="M178 250 L222 250 L232 330 L168 330 Z" fill="${p.dark}"/><ellipse cx="200" cy="332" rx="58" ry="8" fill="${p.darker}"/><rect x="58" y="48" width="284" height="208" rx="12" fill="url(#chin)"/><rect x="66" y="56" width="268" height="152" rx="4" fill="#f4f4f4"/><rect x="72" y="62" width="256" height="140" rx="2" fill="url(#wall)"/>`,
  }),
  tablet: (p) => ({
    defs: WALLPAPER(p, "wall") + SHEEN,
    body: `<rect x="92" y="38" width="216" height="306" rx="24" fill="${p.edge}"/><rect x="95" y="41" width="210" height="300" rx="22" fill="${p.base}"/><rect x="104" y="50" width="192" height="282" rx="14" fill="url(#wall)"/><circle cx="200" cy="45.5" r="2.5" fill="#111"/><rect x="104" y="50" width="192" height="282" rx="14" fill="url(#sheen)"/>`,
  }),
  watch: (p) => ({
    defs: `<linearGradient id="case" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecebe8"/><stop offset="1" stop-color="#a9a7a2"/></linearGradient>${BODY_GRADIENT(p, "band")}`,
    body: `<rect x="158" y="18" width="84" height="120" rx="16" fill="url(#band)"/><rect x="158" y="262" width="84" height="120" rx="16" fill="url(#band)"/><rect x="132" y="104" width="136" height="180" rx="40" fill="url(#case)"/><rect x="143" y="115" width="114" height="158" rx="31" fill="#0a0a0c"/><text x="200" y="196" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="600" fill="#fff">10:09</text><path d="M168 225 A 32 32 0 0 1 232 225" fill="none" stroke="${p.isLight ? "#ff8a3d" : p.light}" stroke-width="6" stroke-linecap="round"/><rect x="266" y="158" width="11" height="34" rx="5" fill="url(#case)"/><rect x="267" y="206" width="7" height="30" rx="3" fill="#b9b7b2"/>`,
  }),
  camera: (p) => ({
    defs: BODY_GRADIENT(p) + `<radialGradient id="glass" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#3b4766"/><stop offset="0.5" stop-color="#11141c"/><stop offset="1" stop-color="#050608"/></radialGradient>`,
    body: `<rect x="150" y="86" width="104" height="48" rx="10" fill="${p.dark}"/><rect x="58" y="118" width="284" height="186" rx="20" fill="url(#body)"/><rect x="58" y="118" width="70" height="186" rx="20" fill="${p.isLight ? "#2a2a2c" : p.darker}"/><circle cx="96" cy="108" r="14" fill="${p.darker}"/><rect x="286" y="104" width="34" height="18" rx="5" fill="${p.darker}"/><circle cx="222" cy="214" r="84" fill="#141416"/><circle cx="222" cy="214" r="84" fill="none" stroke="${p.isLight ? "#bdbdbd" : "#2e2e33"}" stroke-width="6"/><circle cx="222" cy="214" r="62" fill="#1c1f27"/><circle cx="222" cy="214" r="44" fill="url(#glass)"/><circle cx="208" cy="198" r="9" fill="#9fb2d9" opacity="0.5"/>`,
  }),
  headphones: (p) => ({
    defs: BODY_GRADIENT(p, "cup"),
    body: `<path d="M112 222 C112 70 288 70 288 222" fill="none" stroke="${p.dark}" stroke-width="24" stroke-linecap="round"/><path d="M112 222 C112 86 288 86 288 222" fill="none" stroke="${p.light}" stroke-width="8" stroke-linecap="round" opacity="0.6"/><rect x="104" y="160" width="16" height="46" rx="6" fill="${p.darker}"/><rect x="280" y="160" width="16" height="46" rx="6" fill="${p.darker}"/><rect x="76" y="196" width="74" height="128" rx="32" fill="url(#cup)"/><rect x="250" y="196" width="74" height="128" rx="32" fill="url(#cup)"/><rect x="134" y="206" width="22" height="108" rx="11" fill="${p.darker}"/><rect x="244" y="206" width="22" height="108" rx="11" fill="${p.darker}"/>`,
  }),
  earbuds: (p) => {
    const shell = p.isLight ? "#fbfbfb" : p.base;
    const stroke = p.isLight ? "#d9d9d9" : p.darker;
    return {
      defs: "",
      body: `<rect x="114" y="168" width="172" height="140" rx="50" fill="${shell}" stroke="${stroke}" stroke-width="3"/><path d="M116 214 L284 214" stroke="${stroke}" stroke-width="3"/><circle cx="200" cy="248" r="4" fill="#3bd16f"/><g transform="rotate(-18 150 120)"><ellipse cx="150" cy="112" rx="28" ry="24" fill="${shell}" stroke="${stroke}" stroke-width="3"/><rect x="152" y="118" width="16" height="64" rx="8" fill="${shell}" stroke="${stroke}" stroke-width="3"/><ellipse cx="140" cy="108" rx="10" ry="8" fill="#2a2a2a" opacity="0.8"/></g><g transform="rotate(18 250 120)"><ellipse cx="250" cy="112" rx="28" ry="24" fill="${shell}" stroke="${stroke}" stroke-width="3"/><rect x="232" y="118" width="16" height="64" rx="8" fill="${shell}" stroke="${stroke}" stroke-width="3"/><ellipse cx="260" cy="108" rx="10" ry="8" fill="#2a2a2a" opacity="0.8"/></g>`,
    };
  },
  console: (p) => ({
    defs: `<linearGradient id="wing" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shade(p.base, -0.08)}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>`,
    body: `<rect x="170" y="52" width="60" height="300" rx="10" fill="#111"/><rect x="171" y="52" width="3" height="300" fill="#3d7cff" opacity="0.6"/><rect x="226" y="52" width="3" height="300" fill="#3d7cff" opacity="0.6"/><path d="M168 64 C126 50 104 80 106 118 L114 330 C116 352 146 362 168 352 Z" fill="url(#wing)" stroke="#d9d9d9" stroke-width="2"/><path d="M232 64 C274 50 296 80 294 118 L286 330 C284 352 254 362 232 352 Z" fill="url(#wing)" stroke="#d9d9d9" stroke-width="2"/>`,
  }),
  tower: (p) => ({
    defs: BODY_GRADIENT(p),
    body: `<rect x="128" y="48" width="144" height="304" rx="10" fill="url(#body)"/><ellipse cx="200" cy="60" rx="58" ry="10" fill="#0b0b0b"/><circle cx="200" cy="60" r="40" fill="#0f1a10" opacity="0.6"/><circle cx="150" cy="96" r="6" fill="#e5e5e5" opacity="0.8"/><rect x="128" y="48" width="18" height="304" rx="8" fill="#fff" opacity="0.06"/>`,
  }),
  controller: (p) => ({
    defs: BODY_GRADIENT(p),
    body: `<path d="M112 168 C70 168 46 262 66 312 C82 348 124 338 144 300 L256 300 C276 338 318 348 334 312 C354 262 330 168 288 168 Z" fill="url(#body)" stroke="${p.isLight ? "#d6d6d6" : p.darker}" stroke-width="3"/><rect x="164" y="172" width="72" height="52" rx="10" fill="${p.isLight ? "#efefef" : p.dark}"/><circle cx="166" cy="252" r="18" fill="#222"/><circle cx="234" cy="252" r="18" fill="#222"/><path d="M118 206 h12 v-12 h10 v12 h12 v10 h-12 v12 h-10 v-12 h-12 Z" fill="#333"/><circle cx="282" cy="200" r="7" fill="#333"/><circle cx="282" cy="228" r="7" fill="#333"/><circle cx="268" cy="214" r="7" fill="#333"/><circle cx="296" cy="214" r="7" fill="#333"/>`,
  }),
  vr: (p) => ({
    defs: `<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4152"/><stop offset="1" stop-color="#0f1116"/></linearGradient>`,
    body: `<path d="M84 210 C40 214 40 290 120 300" fill="none" stroke="#8d8d8d" stroke-width="18" stroke-linecap="round"/><path d="M316 210 C360 214 360 290 280 300" fill="none" stroke="#8d8d8d" stroke-width="18" stroke-linecap="round"/><path d="M90 168 C90 128 130 118 200 118 C270 118 310 128 310 168 L310 234 C310 272 270 284 200 284 C130 284 90 272 90 234 Z" fill="${p.base}"/><path d="M100 172 C100 138 136 128 200 128 C264 128 300 138 300 172 L300 230 C300 262 264 274 200 274 C136 274 100 262 100 230 Z" fill="url(#glass)"/><path d="M118 150 C150 136 214 134 262 142" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="6" stroke-linecap="round"/><rect x="138" y="276" width="124" height="14" rx="7" fill="#3a3a3a"/>`,
  }),
};

function svg(kind: ArtKind, hex: string, view: "main" | "alt"): string {
  const { defs, body } = DRAW[kind](palette(hex));
  const content =
    view === "main"
      ? `<ellipse cx="200" cy="368" rx="110" ry="9" fill="#000" opacity="0.08"/>${body}`
      : `<ellipse cx="208" cy="372" rx="120" ry="10" fill="#000" opacity="0.1"/><g transform="translate(200 200) rotate(-14) scale(0.86) translate(-200 -200)">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><defs>${defs}</defs>${content}</svg>\n`;
}

const outDir = join(process.cwd(), "public", "images", "products");
mkdirSync(outDir, { recursive: true });

const written = new Set<string>();
for (const product of PRODUCTS) {
  for (const variant of product.variants) {
    for (const view of ["main", "alt"] as const) {
      const path = artPath(product.kind, variant.color, view);
      if (written.has(path)) continue;
      writeFileSync(join(process.cwd(), "public", path), svg(product.kind, variant.hex, view));
      written.add(path);
    }
  }
}
console.log(`Generated ${written.size} product illustrations in public/images/products`);
