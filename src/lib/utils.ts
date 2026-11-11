import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * Formats integer minor units for display: 7999900 INR -> "₹79,999".
 * Paise are shown only when non-zero.
 */
export function formatMoney(amountMinor: number, currency: string = "INR"): string {
  const hasFraction = amountMinor % 100 !== 0;
  const key = `${currency}:${hasFraction}`;
  let formatter = FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    });
    FORMATTERS.set(key, formatter);
  }
  return formatter.format(amountMinor / 100);
}

export function discountPercent(priceMinor: number, compareAtPriceMinor: number | null | undefined): number {
  if (!compareAtPriceMinor || compareAtPriceMinor <= priceMinor) return 0;
  return Math.round(((compareAtPriceMinor - priceMinor) / compareAtPriceMinor) * 100);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "64gb" <-> 64, "1tb" <-> 1024 for URL-friendly storage filters. */
export function storageLabel(gb: number): string {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`;
}

export function storageSlug(gb: number): string {
  return storageLabel(gb).toLowerCase();
}

export function parseStorageSlug(slug: string): number | null {
  const match = /^(\d+)(gb|tb)$/i.exec(slug.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return match[2]!.toLowerCase() === "tb" ? value * 1024 : value;
}
