import { env } from "@/env";

/**
 * Turns a stored image key into a URL. Keys starting with "/" are files under /public
 * (seed artwork); everything else is an object-storage key served by the CDN.
 * Server-side only: client components receive resolved URLs.
 */
export function resolveImageUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;
  if (storageKey.startsWith("/")) return storageKey;
  const base = (env.S3_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/${storageKey.replace(/^\/+/, "")}`;
}
