"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CatalogNavigation {
  pending: boolean;
  /** Applies changes to the query string; any filter change resets to page 1. */
  update: (changes: Record<string, string | null>, options?: { keepPage?: boolean }) => void;
  params: URLSearchParams;
}

const CatalogContext = createContext<CatalogNavigation | null>(null);

export function useCatalogNavigation(): CatalogNavigation {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalogNavigation must be used inside <CatalogFrame>");
  return context;
}

/** Owns URL-synced navigation for the catalog (filters, sort, pagination). */
export function CatalogFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update: CatalogNavigation["update"] = (changes, options) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!options?.keepPage) next.delete("page");
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <CatalogContext.Provider value={{ pending, update, params: new URLSearchParams(searchParams.toString()) }}>
      {children}
    </CatalogContext.Provider>
  );
}

/** Dims the results while the next page of server-rendered results streams in. */
export function CatalogResults({ children }: { children: ReactNode }) {
  const { pending } = useCatalogNavigation();
  return (
    <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "pointer-events-none opacity-50")}>
      {children}
    </div>
  );
}
