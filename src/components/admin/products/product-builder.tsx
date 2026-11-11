"use client";

import { AlertCircle, Archive, Plus, RotateCcw, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, inputClass, selectClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatInteger, parseRupees, rupeesText } from "@/lib/admin/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { cn, formatMoney, storageLabel } from "@/lib/utils";
import { GST_RATE_OPTIONS, HIGHLIGHT_ICONS, type PRODUCT_STATUSES, productInputSchema, variantOptionKey, type ProductFormValues } from "@/schemas/admin";
import { ImageUploader, type UploadedImage } from "./image-uploader";

// ============================================================================ types

interface ColorOption {
  name: string;
  hex: string;
}

interface VariantRow {
  key: string;
  id?: string | undefined;
  sku: string;
  skuEdited: boolean;
  barcode: string;
  color: string | null;
  colorHex: string | null;
  storageGb: number | null;
  ramGb: number | null;
  price: string;
  compareAt: string;
  cost: string;
  weight: string;
  isActive: boolean;
  isDefault: boolean;
  initialStock: string;
  threshold: string;
  /** Existing SKU dropped from the matrix: archived on save. */
  archived: boolean;
}

interface SpecGroup {
  id: string;
  group: string;
  rows: Array<{ id: string; key: string; value: string }>;
}

export interface BuilderOptions {
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; specGroups: string[] }>;
}

export interface BuilderInitial {
  id: string;
  slug: string;
  values: ProductFormValues;
  imageUrls: Record<string, string>;
  stock: Record<string, { onHand: number; reserved: number; available: number }>;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function code(text: string, length: number): string {
  return text.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((word) => (word.length <= 3 ? word : word.slice(0, 3))).join("").slice(0, length);
}

/** BRAND-MODEL-COLOUR-STORAGE-RAM, e.g. APP-IPH15PRO-DEEPUR-256G. */
function generateSku(brand: string, name: string, variant: { color: string | null; storageGb: number | null; ramGb: number | null }): string {
  const brandCode = code(brand || "CLB", 3) || "CLB";
  const model = code(name.replace(new RegExp(`^${brand}\\s*`, "i"), ""), 10) || "ITEM";
  const parts = [brandCode, model];
  if (variant.color) parts.push(code(variant.color, 6));
  if (variant.storageGb) parts.push(variant.storageGb >= 1024 && variant.storageGb % 1024 === 0 ? `${variant.storageGb / 1024}T` : `${variant.storageGb}G`);
  if (variant.ramGb) parts.push(`${variant.ramGb}R`);
  return parts.join("-").replace(/-+/g, "-").slice(0, 64);
}

function cartesian(colors: ColorOption[], storages: number[], rams: number[]) {
  const combos: Array<{ color: ColorOption | null; storageGb: number | null; ramGb: number | null }> = [];
  for (const color of colors.length ? colors : [null]) {
    for (const storageGb of storages.length ? storages : [null]) {
      for (const ramGb of rams.length ? rams : [null]) combos.push({ color, storageGb, ramGb });
    }
  }
  return combos;
}

function toSpecGroups(specs: Record<string, Record<string, string>>): SpecGroup[] {
  return Object.entries(specs).map(([group, fields]) => ({
    id: uid(),
    group,
    rows: Object.entries(fields).map(([key, value]) => ({ id: uid(), key, value })),
  }));
}

function rowFromValues(variant: ProductFormValues["variants"][number]): VariantRow {
  return {
    key: variantOptionKey(variant),
    id: variant.id,
    sku: variant.sku,
    skuEdited: true,
    barcode: variant.barcode ?? "",
    color: variant.color ?? null,
    colorHex: variant.colorHex ?? null,
    storageGb: variant.storageGb,
    ramGb: variant.ramGb,
    price: rupeesText(variant.priceMinor),
    compareAt: rupeesText(variant.compareAtPriceMinor),
    cost: rupeesText(variant.costPriceMinor),
    weight: variant.weightGrams ? String(variant.weightGrams) : "",
    isActive: variant.isActive,
    isDefault: variant.isDefault,
    initialStock: "0",
    threshold: String(variant.lowStockThreshold ?? 5),
    archived: false,
  };
}

// ============================================================================ small pieces

function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted-2">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

function ChipInput<T extends string | number>({ values, onAdd, onRemove, render, placeholder, parse, label }: { values: T[]; onAdd: (value: T) => void; onRemove: (value: T) => void; render: (value: T) => string; placeholder: string; parse: (text: string) => T | null; label: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const value = parse(text);
    if (value !== null && !values.includes(value)) onAdd(value);
    setText("");
  };
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-[7px] border border-line-2 bg-white p-1.5 focus-within:border-ink">
        {values.map((value) => (
          <span key={String(value)} className="flex items-center gap-1 rounded bg-surface px-2 py-1 text-xs font-medium">
            {render(value)}
            <button type="button" onClick={() => onRemove(value)} aria-label={`Remove ${render(value)}`} className="text-muted-2 hover:text-ink">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          aria-label={label}
          className="h-7 min-w-[90px] flex-1 px-1 text-sm focus:outline-none"
        />
      </div>
    </div>
  );
}

// ============================================================================ builder

export function ProductBuilder({ options, initial }: { options: BuilderOptions; initial: BuilderInitial | null }) {
  const router = useRouter();
  const start = initial?.values;

  const [name, setName] = useState(start?.name ?? "");
  const [slug, setSlug] = useState(start?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(initial));
  const [subtitle, setSubtitle] = useState(start?.subtitle ?? "");
  const [summary, setSummary] = useState(start?.summary ?? "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [brandId, setBrandId] = useState(start?.brandId ?? "");
  const [categoryId, setCategoryId] = useState(start?.categoryId ?? "");
  const [status, setStatus] = useState<(typeof PRODUCT_STATUSES)[number]>(start?.status ?? "DRAFT");
  const [isFeatured, setIsFeatured] = useState(start?.isFeatured ?? false);
  const [warranty, setWarranty] = useState(String(start?.warrantyMonths ?? 12));
  const [hsnCode, setHsnCode] = useState(start?.hsnCode ?? "");
  const [gstRate, setGstRate] = useState(start?.gstRateBps === null || start?.gstRateBps === undefined ? "" : String(start.gstRateBps));
  const [metaTitle, setMetaTitle] = useState(start?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(start?.metaDescription ?? "");
  const [specs, setSpecs] = useState<SpecGroup[]>(() => toSpecGroups(start?.specs ?? {}));
  const [highlights, setHighlights] = useState(start?.highlightSpecs ?? []);
  const [images, setImages] = useState<UploadedImage[]>(() =>
    (start?.images ?? []).map((image) => ({
      storageKey: image.storageKey,
      url: initial?.imageUrls[image.storageKey] ?? image.storageKey,
      alt: image.alt,
      width: image.width,
      height: image.height,
      color: image.color ?? null,
      isPrimary: image.isPrimary,
    })),
  );

  const initialRows = (start?.variants ?? []).map(rowFromValues);
  const [colors, setColors] = useState<ColorOption[]>(() => {
    const seen = new Map<string, ColorOption>();
    for (const row of initialRows) if (row.color && !seen.has(row.color)) seen.set(row.color, { name: row.color, hex: row.colorHex ?? "#000000" });
    return [...seen.values()];
  });
  const [storages, setStorages] = useState<number[]>(() => [...new Set(initialRows.map((row) => row.storageGb).filter((v): v is number => v !== null))].sort((a, b) => a - b));
  const [rams, setRams] = useState<number[]>(() => [...new Set(initialRows.map((row) => row.ramGb).filter((v): v is number => v !== null))].sort((a, b) => a - b));
  const [rows, setRows] = useState<VariantRow[]>(initialRows);
  const [newColor, setNewColor] = useState<ColorOption>({ name: "", hex: "#000000" });
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const brandName = options.brands.find((brand) => brand.id === brandId)?.name ?? "";
  const category = options.categories.find((entry) => entry.id === categoryId);

  // Any edit marks the form dirty (drives the unsaved-changes guard).
  useEffect(() => {
    setDirty(true);
  }, [name, slug, subtitle, summary, description, brandId, categoryId, status, isFeatured, warranty, hsnCode, gstRate, metaTitle, metaDescription, specs, highlights, images, rows]);
  useEffect(() => setDirty(false), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  // Regenerate the matrix whenever the option sets change; keep edited rows by option key.
  // An existing product's saved matrix may be sparse (not every combination is sold), so it is
  // only rebuilt once the admin actually changes an option.
  //
  // The skip compares the current option sets against the initial ones instead of using a one-shot
  // flag: React Strict Mode mounts, unmounts and re-mounts every effect in development, so a flag
  // flipped on the first run would let the second run rebuild (and densify) the saved matrix.
  // `optionsTouched` only ever goes false → true, which keeps the effect idempotent under re-runs;
  // once an option has changed, returning to the original sets must still regenerate, otherwise
  // rows added in between would linger.
  const optionSignature = JSON.stringify([colors.map((color) => [color.name, color.hex]), storages, rams]);
  const initialOptionSignature = useRef(initial ? optionSignature : null);
  const optionsTouched = useRef(false);
  useEffect(() => {
    if (!optionsTouched.current && optionSignature === initialOptionSignature.current) return;
    optionsTouched.current = true;
    setRows((current) => {
      const byKey = new Map(current.map((row) => [row.key, row]));
      const template = current.find((row) => !row.archived);
      const next: VariantRow[] = cartesian(colors, storages, rams).map((combo) => {
        const optionsKey = variantOptionKey({ color: combo.color?.name ?? null, storageGb: combo.storageGb, ramGb: combo.ramGb });
        const existing = byKey.get(optionsKey);
        if (existing) return { ...existing, archived: false, colorHex: combo.color?.hex ?? existing.colorHex };
        return {
          key: optionsKey,
          sku: "",
          skuEdited: false,
          barcode: "",
          color: combo.color?.name ?? null,
          colorHex: combo.color?.hex ?? null,
          storageGb: combo.storageGb,
          ramGb: combo.ramGb,
          price: template?.price ?? "",
          compareAt: template?.compareAt ?? "",
          cost: template?.cost ?? "",
          weight: template?.weight ?? "",
          isActive: true,
          isDefault: false,
          initialStock: "0",
          threshold: template?.threshold ?? "5",
          archived: false,
        };
      });
      const keys = new Set(next.map((row) => row.key));
      const dropped = current.filter((row) => row.id && !keys.has(row.key)).map((row) => ({ ...row, archived: true, isDefault: false }));
      const live = next;
      if (!live.some((row) => row.isDefault) && live[0]) live[0] = { ...live[0], isDefault: true };
      return [...live, ...dropped];
    });
  }, [colors, storages, rams, optionSignature]);

  // Auto SKUs for rows the admin has not edited.
  useEffect(() => {
    setRows((current) => {
      let changed = false;
      const next = current.map((row) => {
        if (row.skuEdited || row.id) return row;
        const sku = generateSku(brandName, name, row);
        if (sku === row.sku) return row;
        changed = true;
        return { ...row, sku };
      });
      return changed ? next : current;
    });
  }, [brandName, name, rows.length]);

  const patchRow = (key: string, change: Partial<VariantRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const liveRows = rows.filter((row) => !row.archived);
  const archivedRows = rows.filter((row) => row.archived);
  const errorFor = (path: string) => errors.find((error) => error.path === path)?.message;

  const payload = useMemo((): ProductFormValues => {
    const specObject: Record<string, Record<string, string>> = {};
    for (const group of specs) {
      const title = group.group.trim();
      const entries = group.rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value.trim()] as const);
      if (title && entries.length) specObject[title] = Object.fromEntries(entries);
    }
    const minorOrNull = (text: string) => {
      const value = parseRupees(text);
      return value === null ? null : value;
    };
    return {
      name,
      slug,
      subtitle,
      summary,
      description,
      brandId,
      categoryId,
      status,
      isFeatured,
      warrantyMonths: Number(warranty) || 0,
      hsnCode: hsnCode.trim() || null,
      gstRateBps: gstRate === "" ? null : Number(gstRate),
      metaTitle,
      metaDescription,
      specs: specObject,
      highlightSpecs: highlights.filter((item) => item.label.trim() && item.value.trim()),
      images: images.map(({ url: _url, ...image }) => image),
      variants: liveRows.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        sku: row.sku,
        barcode: row.barcode || null,
        color: row.color,
        colorHex: row.colorHex,
        storageGb: row.storageGb,
        ramGb: row.ramGb,
        priceMinor: minorOrNull(row.price) ?? Number.NaN,
        compareAtPriceMinor: minorOrNull(row.compareAt),
        costPriceMinor: minorOrNull(row.cost),
        weightGrams: row.weight ? Number(row.weight) : null,
        isActive: row.isActive,
        isDefault: row.isDefault,
        initialStock: row.id ? 0 : Number(row.initialStock) || 0,
        lowStockThreshold: Number(row.threshold) || 0,
      })),
    };
  }, [name, slug, subtitle, summary, description, brandId, categoryId, status, isFeatured, warranty, hsnCode, gstRate, metaTitle, metaDescription, specs, highlights, images, liveRows]);

  async function save() {
    setServerError(null);
    const parsed = productInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const response = await apiFetch<{ product: { id: string; slug: string } }>(initial ? `/api/admin/products/${initial.id}` : "/api/admin/products", {
        method: initial ? "PATCH" : "POST",
        body: payload,
      });
      setDirty(false);
      setSavedAt(Date.now());
      if (!initial) router.replace(`/admin/products/${response.product.id}?created=1`);
      else router.refresh();
    } catch (error) {
      setServerError(error instanceof ApiClientError ? error.message : "Could not save the product.");
      if (error instanceof ApiClientError && Array.isArray(error.details)) {
        setErrors((error.details as Array<{ path: string; message: string }>).filter((detail) => detail && typeof detail.path === "string"));
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!initial || !window.confirm("Archive this product? It disappears from the storefront; orders and history are kept.")) return;
    setSaving(true);
    try {
      await apiFetch(`/api/admin/products/${initial.id}`, { method: "DELETE" });
      setDirty(false);
      router.push("/admin/products");
      router.refresh();
    } catch (error) {
      setServerError(error instanceof ApiClientError ? error.message : "Could not archive the product.");
    } finally {
      setSaving(false);
    }
  }

  const margin = (row: VariantRow) => {
    const price = parseRupees(row.price);
    const cost = parseRupees(row.cost);
    if (!price || cost === null || Number.isNaN(cost) || Number.isNaN(price)) return null;
    return (price - cost) / price;
  };

  return (
    <div className="pb-24">
      {(errors.length > 0 || serverError) && (
        <div role="alert" className="mb-5 rounded-[var(--radius-card)] border border-danger/30 bg-[#fdecea] p-4 text-sm text-danger">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden /> {serverError ?? "Fix these before saving:"}
          </p>
          {errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-6">
              {errors.slice(0, 12).map((error, index) => (
                <li key={`${error.path}-${index}`}>
                  {error.path ? <span className="font-mono text-xs">{error.path}</span> : null} {error.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product name" error={errorFor("name")} className="sm:col-span-2">
                <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} maxLength={200} required />
              </Field>
              <Field label="URL slug" hint={`collab.in/products/${slug || "…"}`} error={errorFor("slug")}>
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(event.target.value.toLowerCase());
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="Subtitle" error={errorFor("subtitle")}>
                <input value={subtitle ?? ""} onChange={(event) => setSubtitle(event.target.value)} className={inputClass} maxLength={200} />
              </Field>
              <Field label="Brand" error={errorFor("brandId")}>
                <select value={brandId} onChange={(event) => setBrandId(event.target.value)} className={`${selectClass} w-full`}>
                  <option value="">Choose a brand</option>
                  {options.brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category" error={errorFor("categoryId")}>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={`${selectClass} w-full`}>
                  <option value="">Choose a category</option>
                  {options.categories.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Summary" hint="Short pitch under the product title." className="sm:col-span-2" error={errorFor("summary")}>
                <textarea value={summary ?? ""} onChange={(event) => setSummary(event.target.value)} rows={2} className={`${inputClass} h-auto py-2`} maxLength={2000} />
              </Field>
              <Field label="Description" className="sm:col-span-2" error={errorFor("description")}>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={6} className={`${inputClass} h-auto py-2`} maxLength={20000} />
              </Field>
            </div>
          </Card>

          <Card title="Variant options" actions={<span className="text-xs text-muted-2">{liveRows.length} SKU{liveRows.length === 1 ? "" : "s"} generated</span>}>
            <p className="mb-4 text-sm text-muted-2">Every combination of colour, storage and RAM becomes one SKU. Leave an option empty if the product does not vary by it.</p>
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-sm font-medium">Colours</span>
                <div className="flex flex-wrap gap-2">
                  {colors.map((color) => (
                    <span key={color.name} className="flex items-center gap-2 rounded-md border border-line-2 py-1 pl-1 pr-2 text-sm">
                      <input
                        type="color"
                        value={color.hex}
                        onChange={(event) => setColors((list) => list.map((entry) => (entry.name === color.name ? { ...entry, hex: event.target.value } : entry)))}
                        className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
                        aria-label={`${color.name} swatch colour`}
                      />
                      {color.name}
                      <button type="button" onClick={() => setColors((list) => list.filter((entry) => entry.name !== color.name))} aria-label={`Remove ${color.name}`} className="text-muted-2 hover:text-ink">
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                  <span className="flex items-center gap-2 rounded-md border border-dashed border-line-2 py-1 pl-1 pr-1">
                    <input type="color" value={newColor.hex} onChange={(event) => setNewColor((value) => ({ ...value, hex: event.target.value }))} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="New colour swatch" />
                    <input
                      value={newColor.name}
                      onChange={(event) => setNewColor((value) => ({ ...value, name: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          const label = newColor.name.trim();
                          if (label && !colors.some((color) => color.name.toLowerCase() === label.toLowerCase())) setColors((list) => [...list, { name: label.slice(0, 40), hex: newColor.hex }]);
                          setNewColor({ name: "", hex: "#000000" });
                        }
                      }}
                      placeholder="Colour name ↵"
                      aria-label="New colour name"
                      className="h-7 w-32 text-sm focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const label = newColor.name.trim();
                        if (label && !colors.some((color) => color.name.toLowerCase() === label.toLowerCase())) setColors((list) => [...list, { name: label.slice(0, 40), hex: newColor.hex }]);
                        setNewColor({ name: "", hex: "#000000" });
                      }}
                      className="rounded bg-surface p-1"
                      aria-label="Add colour"
                    >
                      <Plus className="size-4" />
                    </button>
                  </span>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ChipInput
                  label="Storage"
                  values={storages}
                  onAdd={(value) => setStorages((list) => [...list, value].sort((a, b) => a - b))}
                  onRemove={(value) => setStorages((list) => list.filter((entry) => entry !== value))}
                  render={storageLabel}
                  placeholder="e.g. 256 or 1TB ↵"
                  parse={(text) => {
                    const match = /^(\d+)\s*(gb|tb|g|t)?$/i.exec(text.trim());
                    if (!match) return null;
                    const value = Number(match[1]) * (/t/i.test(match[2] ?? "") ? 1024 : 1);
                    return value > 0 && value <= 65536 ? value : null;
                  }}
                />
                <ChipInput
                  label="RAM"
                  values={rams}
                  onAdd={(value) => setRams((list) => [...list, value].sort((a, b) => a - b))}
                  onRemove={(value) => setRams((list) => list.filter((entry) => entry !== value))}
                  render={(value) => `${value}GB`}
                  placeholder="e.g. 8 ↵"
                  parse={(text) => {
                    const value = Number(text.replace(/gb?$/i, "").trim());
                    return Number.isInteger(value) && value > 0 && value <= 4096 ? value : null;
                  }}
                />
              </div>
            </div>
          </Card>

          <Card
            title="SKUs"
            bodyClassName="p-0"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <input value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} placeholder="Price ₹" aria-label="Price for all variants" className="h-8 w-24 rounded border border-line-2 px-2 text-xs" />
                <button type="button" onClick={() => bulkPrice && setRows((list) => list.map((row) => ({ ...row, price: bulkPrice })))} className="h-8 rounded border border-line-2 px-2 text-xs font-medium hover:border-ink">
                  Apply to all
                </button>
                {!initial || liveRows.some((row) => !row.id) ? (
                  <>
                    <input value={bulkStock} onChange={(event) => setBulkStock(event.target.value.replace(/\D/g, ""))} placeholder="Stock" aria-label="Opening stock for new variants" className="h-8 w-20 rounded border border-line-2 px-2 text-xs" />
                    <button type="button" onClick={() => bulkStock && setRows((list) => list.map((row) => (row.id ? row : { ...row, initialStock: bulkStock })))} className="h-8 rounded border border-line-2 px-2 text-xs font-medium hover:border-ink">
                      Set opening stock
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => setRows((list) => list.map((row) => (row.id ? row : { ...row, skuEdited: false, sku: generateSku(brandName, name, row) })))} className="flex h-8 items-center gap-1 rounded border border-line-2 px-2 text-xs font-medium hover:border-ink">
                  <Wand2 className="size-3.5" aria-hidden /> Regenerate SKUs
                </button>
              </div>
            }
          >
            {errorFor("variants") && (
              <p role="alert" className="border-b border-line px-5 py-2 text-xs text-danger">
                {errorFor("variants")}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-tint-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-2">
                    <th className="px-3 py-2">Default</th>
                    <th className="px-3 py-2">Variant</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Price ₹</th>
                    <th className="px-3 py-2">MRP ₹</th>
                    <th className="px-3 py-2">Cost ₹</th>
                    <th className="px-3 py-2">Stock</th>
                    <th className="px-3 py-2">Alert ≤</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((row, index) => {
                    const stock = row.id ? initial?.stock[row.id] : undefined;
                    const m = margin(row);
                    const rowError = (field: string) => errorFor(`variants.${index}.${field}`);
                    return (
                      <tr key={row.key} className="border-b border-line align-top">
                        <td className="px-3 py-2.5">
                          <input type="radio" name="default-variant" checked={row.isDefault} onChange={() => setRows((list) => list.map((entry) => ({ ...entry, isDefault: entry.key === row.key })))} aria-label={`Default variant ${row.sku}`} className="mt-2.5 size-4 accent-black" />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 pt-1.5">
                            {row.colorHex && <span className="size-3.5 shrink-0 rounded-full border border-line-2" style={{ background: row.colorHex }} aria-hidden />}
                            <span className="whitespace-nowrap font-medium">{[row.color, row.storageGb ? storageLabel(row.storageGb) : null, row.ramGb ? `${row.ramGb}GB RAM` : null].filter(Boolean).join(" / ") || "Standard"}</span>
                          </div>
                          {!row.id && <span className="mt-1 inline-block rounded bg-[#e8f1fc] px-1.5 text-[10px] font-semibold uppercase text-[#1c5cab]">New</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <input value={row.sku} onChange={(event) => patchRow(row.key, { sku: event.target.value.toUpperCase(), skuEdited: true })} className={cn("h-9 w-48 rounded border px-2 font-mono text-xs", rowError("sku") ? "border-danger" : "border-line-2")} aria-label="SKU" />
                          {rowError("sku") && <p className="mt-1 max-w-48 text-[11px] text-danger">{rowError("sku")}</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          <input value={row.price} onChange={(event) => patchRow(row.key, { price: event.target.value })} inputMode="decimal" className={cn("h-9 w-24 rounded border px-2 tabular-nums", rowError("priceMinor") ? "border-danger" : "border-line-2")} aria-label="Price" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input value={row.compareAt} onChange={(event) => patchRow(row.key, { compareAt: event.target.value })} inputMode="decimal" className={cn("h-9 w-24 rounded border px-2 tabular-nums", rowError("compareAtPriceMinor") ? "border-danger" : "border-line-2")} aria-label="Compare-at price" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input value={row.cost} onChange={(event) => patchRow(row.key, { cost: event.target.value })} inputMode="decimal" className="h-9 w-24 rounded border border-line-2 px-2 tabular-nums" aria-label="Cost price" />
                          {m !== null && <p className={cn("mt-1 text-[11px]", m < 0 ? "text-danger" : "text-muted-2")}>{(m * 100).toFixed(0)}% margin</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          {row.id ? (
                            <div className="pt-1.5 text-xs leading-5">
                              <p className="font-medium tabular-nums">{formatInteger(stock?.available ?? 0)} available</p>
                              <p className="text-muted-2 tabular-nums">
                                {stock?.onHand ?? 0} on hand · {stock?.reserved ?? 0} held
                              </p>
                              <Link href={`/admin/inventory?q=${encodeURIComponent(row.sku)}`} className="text-[11px] underline">
                                Adjust
                              </Link>
                            </div>
                          ) : (
                            <input value={row.initialStock} onChange={(event) => patchRow(row.key, { initialStock: event.target.value.replace(/\D/g, "") })} inputMode="numeric" className="h-9 w-20 rounded border border-line-2 px-2 tabular-nums" aria-label="Opening stock" />
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <input value={row.threshold} onChange={(event) => patchRow(row.key, { threshold: event.target.value.replace(/\D/g, "") })} inputMode="numeric" className="h-9 w-16 rounded border border-line-2 px-2 tabular-nums" aria-label="Low-stock threshold" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input value={row.barcode} onChange={(event) => patchRow(row.key, { barcode: event.target.value.replace(/\D/g, "") })} inputMode="numeric" className={cn("h-9 w-32 rounded border px-2 font-mono text-xs", rowError("barcode") ? "border-danger" : "border-line-2")} aria-label="Barcode" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={row.isActive} onChange={(event) => patchRow(row.key, { isActive: event.target.checked })} className="mt-2.5 size-4 accent-black" aria-label={`Active ${row.sku}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {archivedRows.length > 0 && (
              <div className="border-t border-line bg-[#fff4d6]/50 px-5 py-3 text-xs">
                <p className="flex items-center gap-1.5 font-medium text-[#8a5a00]">
                  <Archive className="size-3.5" aria-hidden /> Will be archived on save (kept for order history):
                </p>
                <p className="mt-1 font-mono text-muted-2">{archivedRows.map((row) => row.sku).join(", ")}</p>
                <p className="mt-1 flex items-center gap-1 text-muted-2">
                  <RotateCcw className="size-3" aria-hidden /> Re-add the option value to keep a SKU.
                </p>
              </div>
            )}
          </Card>

          <Card title="Images">
            <ImageUploader images={images} onChange={setImages} productId={initial?.id ?? null} colors={colors.map((color) => color.name)} defaultAlt={name || "Product image"} />
          </Card>

          <Card
            title="Technical specifications"
            actions={
              <button type="button" onClick={() => setSpecs((list) => [...list, { id: uid(), group: "", rows: [{ id: uid(), key: "", value: "" }] }])} className="flex items-center gap-1 text-xs font-medium">
                <Plus className="size-3.5" aria-hidden /> Add group
              </button>
            }
          >
            <datalist id="spec-groups">
              {(category?.specGroups ?? []).map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
            {specs.length === 0 && <p className="text-sm text-muted-2">No specification groups yet (e.g. Display, Processor & GPU, Battery).</p>}
            <div className="space-y-5">
              {specs.map((group) => (
                <fieldset key={group.id} className="rounded-md border border-line p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={group.group}
                      list="spec-groups"
                      onChange={(event) => setSpecs((list) => list.map((entry) => (entry.id === group.id ? { ...entry, group: event.target.value } : entry)))}
                      placeholder="Group (e.g. Display)"
                      aria-label="Specification group"
                      className="h-9 flex-1 rounded border border-line-2 px-2 text-sm font-medium"
                    />
                    <button type="button" onClick={() => setSpecs((list) => list.filter((entry) => entry.id !== group.id))} className="rounded p-1.5 text-danger hover:bg-surface" aria-label="Remove group">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {group.rows.map((row) => (
                      <div key={row.id} className="flex gap-2">
                        <input
                          value={row.key}
                          onChange={(event) => setSpecs((list) => list.map((entry) => (entry.id === group.id ? { ...entry, rows: entry.rows.map((r) => (r.id === row.id ? { ...r, key: event.target.value } : r)) } : entry)))}
                          placeholder="Name"
                          aria-label="Specification name"
                          className="h-9 w-2/5 rounded border border-line-2 px-2 text-sm"
                        />
                        <input
                          value={row.value}
                          onChange={(event) => setSpecs((list) => list.map((entry) => (entry.id === group.id ? { ...entry, rows: entry.rows.map((r) => (r.id === row.id ? { ...r, value: event.target.value } : r)) } : entry)))}
                          placeholder="Value"
                          aria-label="Specification value"
                          className="h-9 flex-1 rounded border border-line-2 px-2 text-sm"
                        />
                        <button type="button" onClick={() => setSpecs((list) => list.map((entry) => (entry.id === group.id ? { ...entry, rows: entry.rows.filter((r) => r.id !== row.id) } : entry)))} className="rounded p-1.5 text-muted-2 hover:bg-surface" aria-label="Remove row">
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setSpecs((list) => list.map((entry) => (entry.id === group.id ? { ...entry, rows: [...entry.rows, { id: uid(), key: "", value: "" }] } : entry)))} className="text-xs font-medium text-muted-2 hover:text-ink">
                      + Add row
                    </button>
                  </div>
                </fieldset>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Publishing">
            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${selectClass} w-full`}>
                <option value="DRAFT">Draft — hidden from the store</option>
                <option value="ACTIVE">Active — live on the store</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </Field>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isFeatured} onChange={(event) => setIsFeatured(event.target.checked)} className="size-4 accent-black" /> Featured on the home page
            </label>
            <Field label="Warranty (months)" className="mt-4" error={errorFor("warrantyMonths")}>
              <input value={warranty} onChange={(event) => setWarranty(event.target.value.replace(/\D/g, ""))} inputMode="numeric" className={inputClass} />
            </Field>
            <Field label="HSN code" className="mt-4" hint={`Blank = category default${category ? "" : " (choose a category)"}.`} error={errorFor("hsnCode")}>
              <input value={hsnCode} onChange={(event) => setHsnCode(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="e.g. 8517" className={inputClass} />
            </Field>
            <Field label="GST rate" className="mt-4" hint="Prices are GST-inclusive; the rate splits tax on the invoice." error={errorFor("gstRateBps")}>
              <select value={gstRate} onChange={(event) => setGstRate(event.target.value)} className={`${selectClass} w-full`}>
                <option value="">Category default (usually 18%)</option>
                {GST_RATE_OPTIONS.map((bps) => (
                  <option key={bps} value={bps}>
                    {bps / 100}%
                  </option>
                ))}
              </select>
            </Field>
            {initial && status === "ACTIVE" && (
              <Link href={`/products/${initial.slug}`} target="_blank" className="mt-4 inline-block text-xs font-medium underline underline-offset-4">
                View on storefront ↗
              </Link>
            )}
          </Card>

          <Card
            title="Headline specs"
            actions={
              highlights.length < 6 ? (
                <button type="button" onClick={() => setHighlights((list) => [...list, { icon: "screen", label: "", value: "" }])} className="flex items-center gap-1 text-xs font-medium">
                  <Plus className="size-3.5" aria-hidden /> Add
                </button>
              ) : null
            }
          >
            <p className="mb-3 text-xs text-muted-2">Up to six cards shown beside the gallery.</p>
            <div className="space-y-2">
              {highlights.map((item, index) => (
                <div key={index} className="grid grid-cols-[96px_1fr_1fr_auto] gap-1.5">
                  <select value={item.icon} onChange={(event) => setHighlights((list) => list.map((entry, i) => (i === index ? { ...entry, icon: event.target.value as (typeof HIGHLIGHT_ICONS)[number] } : entry)))} className="h-9 rounded border border-line-2 px-1 text-xs" aria-label="Icon">
                    {HIGHLIGHT_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {icon}
                      </option>
                    ))}
                  </select>
                  <input value={item.label} onChange={(event) => setHighlights((list) => list.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)))} placeholder="Label" aria-label="Label" maxLength={40} className="h-9 min-w-0 rounded border border-line-2 px-2 text-xs" />
                  <input value={item.value} onChange={(event) => setHighlights((list) => list.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)))} placeholder="Value" aria-label="Value" maxLength={60} className="h-9 min-w-0 rounded border border-line-2 px-2 text-xs" />
                  <button type="button" onClick={() => setHighlights((list) => list.filter((_, i) => i !== index))} className="rounded p-1.5 text-muted-2 hover:bg-surface" aria-label="Remove headline spec">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Search engine listing">
            <Field label="Meta title" hint={`${(metaTitle ?? "").length}/70`} error={errorFor("metaTitle")}>
              <input value={metaTitle ?? ""} onChange={(event) => setMetaTitle(event.target.value)} maxLength={70} className={inputClass} />
            </Field>
            <Field label="Meta description" hint={`${(metaDescription ?? "").length}/170`} className="mt-4" error={errorFor("metaDescription")}>
              <textarea value={metaDescription ?? ""} onChange={(event) => setMetaDescription(event.target.value)} maxLength={170} rows={3} className={`${inputClass} h-auto py-2`} />
            </Field>
          </Card>

          {liveRows.length > 0 && (
            <Card title="Price range">
              <p className="text-sm tabular-nums">
                {(() => {
                  const prices = liveRows.map((row) => parseRupees(row.price)).filter((value): value is number => value !== null && !Number.isNaN(value));
                  if (prices.length === 0) return "Set variant prices";
                  const min = Math.min(...prices);
                  const max = Math.max(...prices);
                  return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`;
                })()}
              </p>
            </Card>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur lg:left-[232px]">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-xs text-muted-2" aria-live="polite">
            {saving ? "Saving…" : savedAt && !dirty ? "All changes saved" : dirty ? "Unsaved changes" : ""}
          </p>
          <div className="flex gap-2">
            {initial && (
              <Button type="button" variant="ghost" size="sm" onClick={archive} disabled={saving}>
                <Archive className="size-4" aria-hidden /> Archive
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/admin/products">Cancel</Link>
            </Button>
            <Button type="button" size="sm" onClick={save} loading={saving}>
              {initial ? "Save changes" : "Create product"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
