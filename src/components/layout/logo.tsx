import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * "Collab" wordmark - replaces the template's "cyber" logo while keeping its footprint
 * (65x23 at desktop) and weight.
 */
export function Logo({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <Link href="/" aria-label="Collab home" className={cn("inline-flex shrink-0 items-center", className)}>
      <svg width="78" height="24" viewBox="0 0 78 24" fill="none" aria-hidden className={tone === "light" ? "text-white" : "text-ink"}>
        <text x="0" y="19" fill="currentColor" fontFamily="var(--font-inter), 'SF Pro Display', sans-serif" fontSize="22" fontWeight="700" letterSpacing="-0.5">
          Collab
        </text>
      </svg>
    </Link>
  );
}
