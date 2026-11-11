/** Display helpers for the admin portal (client-safe, no server imports). */

const TIME_ZONE = "Asia/Kolkata";

const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const integer = new Intl.NumberFormat("en-IN");
const compactInr = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateOnly.format(typeof value === "string" ? new Date(value) : value);
}

/** "2026-11-04" (a calendar day) -> "4 Nov". */
export function formatDay(day: string): string {
  return shortDay.format(new Date(`${day}T00:00:00Z`));
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** ₹1.2L-style compact rupees for chart axes (minor units in). */
export function formatCompactInr(minor: number): string {
  return `₹${compactInr.format(minor / 100)}`;
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** "OUT_FOR_DELIVERY" -> "Out for delivery". */
export function humanize(value: string): string {
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function relativeTime(value: string | Date): string {
  const ms = Date.now() - (typeof value === "string" ? new Date(value) : value).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Rupee text input -> minor units (null for empty, NaN for invalid). */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

export function rupeesText(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const ORDER_STATUS_TONE: Record<string, Tone> = {
  PENDING_PAYMENT: "warning",
  PLACED: "info",
  CONFIRMED: "info",
  PACKED: "info",
  SHIPPED: "info",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
  PAYMENT_FAILED: "danger",
  RETURNED: "neutral",
};

/** "2026-11-04" date-input value -> ISO bound of that calendar day in IST (undefined if invalid). */
export function dayBound(day: string | undefined, end: boolean): string | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const iso = `${day}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`;
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}
