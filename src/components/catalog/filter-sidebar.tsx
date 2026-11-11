"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import type { CatalogResult, Facet } from "@/types/catalog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Checkbox, RangeSlider } from "@/components/ui/controls";
import { useCatalogNavigation } from "./catalog-frame";

const PRICE_STEP_MINOR = 500_00;

function toggleValue(current: string | null, value: string): string | null {
  const values = new Set((current ?? "").split(",").filter(Boolean));
  if (values.has(value)) values.delete(value);
  else values.add(value);
  return values.size ? [...values].join(",") : null;
}

export function FilterSidebar({ facets, price }: { facets: Facet[]; price: CatalogResult["price"] }) {
  const { update, params } = useCatalogNavigation();
  const hasFilters = [...params.keys()].some((key) => key !== "sort" && key !== "page" && key !== "q");

  return (
    <div>
      <Accordion type="multiple" defaultValue={["price", ...facets.slice(0, 3).map((facet) => facet.key)]}>
        {price.boundsMax > price.boundsMin && (
          <AccordionItem value="price">
            <AccordionTrigger>Price</AccordionTrigger>
            <AccordionContent>
              <PriceFilter price={price} onCommit={(min, max) => update({ min, max })} />
            </AccordionContent>
          </AccordionItem>
        )}
        {facets.map((facet) => (
          <AccordionItem key={facet.key} value={facet.key}>
            <AccordionTrigger>{facet.label}</AccordionTrigger>
            <AccordionContent>
              <FacetList facet={facet} searchable={facet.key === "brand"} onToggle={(value) => update({ [facet.key]: toggleValue(params.get(facet.key), value) })} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {hasFilters && (
        <button
          type="button"
          onClick={() => update(Object.fromEntries([...params.keys()].filter((key) => key !== "sort" && key !== "q").map((key) => [key, null])))}
          className="mt-4 text-sm font-medium underline underline-offset-4"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

function FacetList({ facet, searchable, onToggle }: { facet: Facet; searchable: boolean; onToggle: (value: string) => void }) {
  const [term, setTerm] = useState("");
  const visible = useMemo(
    () => (term ? facet.options.filter((option) => option.label.toLowerCase().includes(term.toLowerCase())) : facet.options),
    [facet.options, term],
  );
  return (
    <div>
      {searchable && facet.options.length > 6 && (
        <label className="mb-3 flex h-10 items-center gap-2 rounded-lg bg-search px-3">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search"
            aria-label={`Search ${facet.label.toLowerCase()}`}
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </label>
      )}
      <ul className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
        {visible.map((option) => {
          const id = `${facet.key}-${option.value}`;
          return (
            <li key={option.value} className="flex items-center gap-2">
              <Checkbox id={id} checked={option.selected} disabled={!option.selected && option.count === 0} onCheckedChange={() => onToggle(option.value)} />
              <label htmlFor={id} className="flex flex-1 cursor-pointer items-baseline gap-1 text-[15px] font-medium peer-disabled:cursor-default peer-disabled:opacity-40">
                {option.label}
                <span className="text-xs font-normal text-muted">{option.count}</span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && <li className="py-2 text-sm text-muted">No matches</li>}
      </ul>
    </div>
  );
}

function PriceFilter({ price, onCommit }: { price: CatalogResult["price"]; onCommit: (min: string | null, max: string | null) => void }) {
  const lower = price.selectedMin ?? price.boundsMin;
  const upper = price.selectedMax ?? price.boundsMax;
  const [range, setRange] = useState<[number, number]>([lower, upper]);
  useEffect(() => setRange([lower, upper]), [lower, upper]);

  const commit = ([min, max]: [number, number]) => {
    const clampedMin = Math.max(price.boundsMin, Math.min(min, max));
    const clampedMax = Math.min(price.boundsMax, Math.max(min, max));
    onCommit(
      clampedMin > price.boundsMin ? String(Math.round(clampedMin / 100)) : null,
      clampedMax < price.boundsMax ? String(Math.round(clampedMax / 100)) : null,
    );
  };

  return (
    <div className="space-y-4">
      <RangeSlider
        min={price.boundsMin}
        max={price.boundsMax}
        step={PRICE_STEP_MINOR}
        minStepsBetweenThumbs={1}
        value={range}
        onValueChange={(value) => setRange([value[0]!, value[1]!])}
        onValueCommit={(value) => commit([value[0]!, value[1]!])}
      />
      <div className="flex items-center gap-2">
        <PriceInput label="Minimum price" value={range[0]} onCommit={(minor) => commit([minor, range[1]])} />
        <span className="text-muted" aria-hidden>
          –
        </span>
        <PriceInput label="Maximum price" value={range[1]} onCommit={(minor) => commit([range[0], minor])} />
      </div>
      <p className="text-xs text-muted-2">
        {formatMoney(range[0])} – {formatMoney(range[1])}
      </p>
    </div>
  );
}

function PriceInput({ label, value, onCommit }: { label: string; value: number; onCommit: (minor: number) => void }) {
  const [text, setText] = useState(String(Math.round(value / 100)));
  useEffect(() => setText(String(Math.round(value / 100))), [value]);
  const commit = () => {
    const rupees = Number(text.replace(/[^\d]/g, ""));
    if (Number.isFinite(rupees)) onCommit(rupees * 100);
  };
  return (
    <label className="flex h-10 flex-1 items-center rounded-md border border-line-2 px-2 focus-within:border-ink">
      <span className="text-sm text-muted">₹</span>
      <input
        inputMode="numeric"
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        className="w-full bg-transparent px-1 text-sm focus:outline-none"
      />
    </label>
  );
}
