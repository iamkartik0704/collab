"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { apiFetch } from "@/lib/api-client";
import { cn, formatMoney } from "@/lib/utils";
import type { SearchSuggestion } from "@/types/catalog";

type Option =
  | { kind: "product"; key: string; href: string; label: string; imageUrl: string | null; price: string }
  | { kind: "category"; key: string; href: string; label: string };

/**
 * Debounced (250 ms) global search with an accessible combobox dropdown:
 * arrow keys move, Enter opens the highlighted result or searches the catalog, Escape closes.
 */
export function SearchAutocomplete({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = useDebouncedValue(value.trim(), 250);

  const { data, isFetching } = useQuery({
    queryKey: ["suggest", query.toLowerCase()],
    queryFn: ({ signal }) => apiFetch<SearchSuggestion>(`/api/search/suggest?q=${encodeURIComponent(query)}`, { signal }),
    enabled: query.length >= 2,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

  const options: Option[] =
    query.length >= 2 && data
      ? [
          ...data.categories.map((category) => ({
            kind: "category" as const,
            key: `c-${category.slug}`,
            href: `/catalog/${category.slug}`,
            label: category.name,
          })),
          ...data.products.map((product) => ({
            kind: "product" as const,
            key: `p-${product.slug}`,
            href: `/products/${product.slug}`,
            label: product.name,
            imageUrl: product.imageUrl,
            price: formatMoney(product.priceMinor, product.currency),
          })),
        ]
      : [];

  useEffect(() => setActive(-1), [query]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setValue("");
    onNavigate?.();
    router.push(href);
  };

  const submit = () => {
    const option = options[active];
    if (option) return go(option.href);
    if (value.trim()) go(`/catalog?q=${encodeURIComponent(value.trim())}`);
  };

  const showPanel = open && query.length >= 2;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex h-14 items-center gap-2 rounded-lg bg-search px-4"
      >
        <Search className="size-5 shrink-0 text-muted" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listboxId}-${active}` : undefined}
          aria-label="Search products"
          placeholder="Search"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, -1));
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="h-full w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          autoComplete="off"
          enterKeyHint="search"
        />
        {isFetching && <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden />}
      </form>

      {showPanel && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-lg border border-line bg-white shadow-xl">
          <ul id={listboxId} role="listbox" aria-label="Search suggestions" className="max-h-[420px] overflow-y-auto py-1">
            {options.map((option, index) => (
              <li
                key={option.key}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(option.href)}
                className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm", index === active && "bg-surface")}
              >
                {option.kind === "product" ? (
                  <>
                    <span className="relative size-10 shrink-0 rounded-md bg-surface">
                      {option.imageUrl && (
                        <Image src={option.imageUrl} alt="" fill sizes="40px" unoptimized={option.imageUrl.endsWith(".svg")} className="object-contain p-1" />
                      )}
                    </span>
                    <span className="flex-1 truncate">{option.label}</span>
                    <span className="font-medium">{option.price}</span>
                  </>
                ) : (
                  <>
                    <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted-2">Category</span>
                    <span className="flex-1">{option.label}</span>
                  </>
                )}
              </li>
            ))}
            {!isFetching && options.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No matches for “{query}”.</li>}
          </ul>
          {value.trim() && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(`/catalog?q=${encodeURIComponent(value.trim())}`)}
              className="w-full border-t border-line px-4 py-3 text-left text-sm font-medium hover:bg-surface"
            >
              See all results for “{value.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
