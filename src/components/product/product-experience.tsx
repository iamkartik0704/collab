"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ShieldCheck, Store, Truck, XCircle } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type MouseEvent } from "react";
import { useWishlist } from "@/hooks/use-wishlist";
import { cn, discountPercent, formatMoney, storageLabel } from "@/lib/utils";
import type { GalleryImage, ProductDetail, VariantOption } from "@/types/catalog";
import { SpecIcon } from "@/components/shared/icons";
import { Button } from "@/components/ui/button";
import { useAddToCart } from "./add-to-cart";
import { RatingStars } from "./rating-stars";

interface Props {
  product: ProductDetail;
  availability: Record<string, number>;
  initialVariantId: string | null;
}

/** Picks the variant matching a changed option, keeping the other selections when possible. */
function resolveVariant(variants: VariantOption[], current: VariantOption, change: Partial<Pick<VariantOption, "color" | "storageGb" | "ramGb">>): VariantOption {
  const wanted = { color: current.color, storageGb: current.storageGb, ramGb: current.ramGb, ...change };
  const score = (variant: VariantOption) =>
    (variant.color === wanted.color ? 4 : 0) + (variant.storageGb === wanted.storageGb ? 2 : 0) + (variant.ramGb === wanted.ramGb ? 1 : 0);
  const changedKey = Object.keys(change)[0] as keyof typeof change;
  return [...variants]
    .filter((variant) => variant[changedKey] === change[changedKey])
    .sort((a, b) => score(b) - score(a))[0] ?? current;
}

export function ProductExperience({ product, availability, initialVariantId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [variant, setVariant] = useState<VariantOption>(
    () => product.variants.find((v) => v.id === initialVariantId) ?? product.variants.find((v) => v.isDefault) ?? product.variants[0]!,
  );
  const select = (next: VariantOption) => {
    setVariant(next);
    router.replace(`${pathname}?variant=${next.id}`, { scroll: false });
  };

  const colors = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of product.variants) if (v.color && !seen.has(v.color)) seen.set(v.color, v.colorHex);
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }));
  }, [product.variants]);
  const storages = useMemo(() => [...new Set(product.variants.map((v) => v.storageGb).filter((v): v is number => v !== null))].sort((a, b) => a - b), [product.variants]);
  const rams = useMemo(() => [...new Set(product.variants.map((v) => v.ramGb).filter((v): v is number => v !== null))].sort((a, b) => a - b), [product.variants]);

  const available = availability[variant.id] ?? 0;
  const images = useMemo(() => {
    // Images of the selected colour when present, else the product's shared images. Several
    // variants of one colour may point at the same file, so URLs are de-duplicated.
    const unique = (list: GalleryImage[]) => list.filter((image, i) => list.findIndex((other) => other.url === image.url) === i);
    const specific = product.images.filter((image) =>
      variant.color ? image.color === variant.color : image.variantId === variant.id,
    );
    const shared = product.images.filter((image) => image.variantId === null);
    return unique(specific.length ? specific : shared.length ? shared : product.images);
  }, [product.images, variant.id, variant.color]);

  const discount = discountPercent(variant.priceMinor, variant.compareAtPriceMinor);
  const { add, pending, error } = useAddToCart();
  const wishlist = useWishlist();
  const saved = wishlist.has(product.id);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="grid gap-10 lg:grid-cols-[536px_1fr] lg:gap-12">
      <Gallery images={images} name={product.name} />

      <div>
        <h1 className="text-[32px] font-bold leading-tight lg:text-[40px]">{product.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded bg-surface px-2 py-1 font-mono text-xs text-muted-2">SKU {variant.sku}</span>
          {product.ratingCount > 0 && (
            <a href="#reviews" className="flex items-center gap-2 text-sm text-muted-2 hover:text-ink">
              <RatingStars value={product.ratingAverage} />
              {product.ratingAverage.toFixed(1)} · {product.ratingCount} reviews
            </a>
          )}
        </div>

        <div className="mt-6 flex items-baseline gap-4" aria-live="polite">
          <span className="text-[32px] font-medium">{formatMoney(variant.priceMinor, variant.currency)}</span>
          {variant.compareAtPriceMinor && variant.compareAtPriceMinor > variant.priceMinor && (
            <>
              <span className="text-2xl text-muted line-through">{formatMoney(variant.compareAtPriceMinor, variant.currency)}</span>
              <span className="rounded bg-ink px-2 py-0.5 text-xs font-semibold text-white">−{discount}%</span>
            </>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-2">Inclusive of all taxes</p>

        {colors.length > 1 && (
          <fieldset className="mt-6">
            <legend className="mb-3 text-[15px]">
              Select color: <span className="font-medium">{variant.color}</span>
            </legend>
            <div className="flex gap-2">
              {colors.map((color) => (
                <label key={color.name} className="cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={color.name}
                    checked={variant.color === color.name}
                    onChange={() => select(resolveVariant(product.variants, variant, { color: color.name }))}
                    className="peer sr-only"
                  />
                  <span
                    title={color.name}
                    className="block size-8 rounded-full ring-1 ring-black/10 ring-offset-2 transition-shadow peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-ink"
                    style={{ backgroundColor: color.hex ?? "#d5d5d5" }}
                  />
                  <span className="sr-only">{color.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {storages.length > 1 && (
          <OptionPills
            legend="Storage"
            options={storages.map((gb) => ({ key: String(gb), label: storageLabel(gb), active: variant.storageGb === gb, exists: product.variants.some((v) => v.storageGb === gb && v.color === variant.color) }))}
            onSelect={(key) => select(resolveVariant(product.variants, variant, { storageGb: Number(key) }))}
          />
        )}
        {rams.length > 1 && (
          <OptionPills
            legend="Memory (RAM)"
            options={rams.map((gb) => ({ key: String(gb), label: storageLabel(gb), active: variant.ramGb === gb, exists: product.variants.some((v) => v.ramGb === gb && v.color === variant.color) }))}
            onSelect={(key) => select(resolveVariant(product.variants, variant, { ramGb: Number(key) }))}
          />
        )}

        {product.highlightSpecs.length > 0 && (
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {product.highlightSpecs.slice(0, 6).map((spec) => (
              <li key={spec.label} className="flex items-center gap-2 rounded-[7px] bg-surface px-3 py-4">
                <SpecIcon icon={spec.icon} className="size-6 shrink-0 text-muted-2" />
                <div className="min-w-0">
                  <p className="text-sm text-muted-2">{spec.label}</p>
                  <p className="truncate text-sm font-medium">{spec.value}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {product.summary && (
          <div className="mt-6">
            <p className={cn("text-sm leading-6 text-muted-2", !expanded && "line-clamp-3")}>{product.summary}</p>
            <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-1 text-sm font-medium underline underline-offset-4" aria-expanded={expanded}>
              {expanded ? "less" : "more..."}
            </button>
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Button variant="outline" size="lg" className="px-6" onClick={() => wishlist.toggle(product.id)} aria-pressed={saved}>
            {saved ? "Saved to Wishlist" : "Add to Wishlist"}
          </Button>
          <Button size="lg" className="px-6" loading={pending} disabled={available <= 0} onClick={() => add(variant.id)}>
            {available > 0 ? "Add to Cart" : "Out of stock"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}

        <ul className="mt-8 grid grid-cols-3 gap-4">
          <Badge icon={<Truck className="size-6" strokeWidth={1.5} />} label="Free Delivery" value="Orders ₹999+" />
          <Badge
            icon={available > 0 ? <Store className="size-6" strokeWidth={1.5} /> : <XCircle className="size-6 text-danger" strokeWidth={1.5} />}
            label={available > 0 ? "In Stock" : "Out of stock"}
            value={available > 0 ? (available <= 5 ? `Only ${available} left` : "Today") : "Notify me"}
            tone={available > 0 ? (available <= 5 ? "warn" : "ok") : "bad"}
          />
          <Badge
            icon={<ShieldCheck className="size-6" strokeWidth={1.5} />}
            label="Official Warranty"
            value={product.warrantyMonths % 12 === 0 ? `${product.warrantyMonths / 12} year${product.warrantyMonths > 12 ? "s" : ""}` : `${product.warrantyMonths} months`}
          />
        </ul>
      </div>
    </div>
  );
}

function OptionPills({ legend, options, onSelect }: { legend: string; options: Array<{ key: string; label: string; active: boolean; exists: boolean }>; onSelect: (key: string) => void }) {
  return (
    <fieldset className="mt-6">
      <legend className="mb-3 text-[15px]">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelect(option.key)}
            aria-pressed={option.active}
            className={cn(
              "h-12 min-w-[88px] rounded-lg border px-6 text-sm font-medium transition-colors",
              option.active ? "border-ink text-ink" : "border-line-2 text-muted hover:border-muted-2 hover:text-ink",
              !option.exists && !option.active && "border-dashed opacity-60",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Badge({ icon, label, value, tone = "ok" }: { icon: React.ReactNode; label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-[11px] bg-surface text-muted-2">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm text-muted">{label}</span>
        <span className={cn("block truncate text-sm font-medium", tone === "warn" && "text-[#b45309]", tone === "bad" && "text-danger")}>
          {tone === "ok" && label === "In Stock" && <CheckCircle2 className="mr-1 inline size-3.5 text-success" aria-hidden />}
          {value}
        </span>
      </span>
    </li>
  );
}

/** Vertical thumbnail strip + main image with hover/tap zoom (2x, follows the pointer). */
function Gallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const current = images[Math.min(index, images.length - 1)];

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setZoom({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
  };

  return (
    <div className="flex flex-col-reverse gap-6 sm:flex-row sm:items-center lg:gap-12">
      {images.length > 1 && (
        <ul className="flex gap-4 overflow-x-auto scrollbar-none sm:flex-col" aria-label="Product images">
          {images.map((image, i) => (
            <li key={`${image.url}-${i}`}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show image ${i + 1}`}
                aria-current={i === index}
                className={cn("relative block size-[74px] rounded-md transition-opacity", i === index ? "opacity-100" : "opacity-40 hover:opacity-80")}
              >
                <Image src={image.url} alt="" fill sizes="74px" unoptimized={image.url.endsWith(".svg")} className="object-contain" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className="relative mx-auto aspect-[413/516] w-full max-w-[413px] cursor-zoom-in overflow-hidden"
        onMouseMove={onMove}
        onMouseLeave={() => setZoom(null)}
        onClick={(event) => (zoom ? setZoom(null) : onMove(event))}
      >
        <AnimatePresence mode="wait">
          {current && (
            <motion.div key={current.url} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <Image
                src={current.url}
                alt={current.alt || name}
                fill
                priority
                sizes="(min-width: 1024px) 413px, 90vw"
                unoptimized={current.url.endsWith(".svg")}
                className="object-contain transition-transform duration-200 ease-out"
                style={zoom ? { transform: "scale(2)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
