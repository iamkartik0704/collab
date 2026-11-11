"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const COLLAPSED_GROUPS = 2;

/** PostgreSQL JSONB does not keep key order, so groups are shown in a canonical order. */
const GROUP_ORDER = ["Display", "Processor & GPU", "Memory", "Camera", "Sensor", "Video", "Focus", "Audio", "Battery", "Health", "Connectivity", "General", "Box Contents"];

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

/** Grouped key/value technical specifications with a "View More" toggle. */
export function SpecTable({ specs, description }: { specs: Record<string, Record<string, string>>; description: string }) {
  const groups = Object.entries(specs)
    .filter(([, fields]) => Object.keys(fields).length > 0)
    .sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b));
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? groups : groups.slice(0, COLLAPSED_GROUPS);

  return (
    <section aria-labelledby="details-title" className="rounded-[var(--radius-card)] bg-white px-6 py-10 sm:px-10">
      <h2 id="details-title" className="text-2xl font-medium">
        Details
      </h2>
      <p className="mt-6 text-sm leading-6 text-muted-2">{description}</p>
      {visible.map(([group, fields]) => (
        <div key={group} className="mt-8">
          <h3 className="text-xl font-medium">{group}</h3>
          <dl className="mt-4 divide-y divide-line">
            {Object.entries(fields).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-6 py-3 text-[15px]">
                <dt className="text-ink">{key}</dt>
                <dd className="text-right text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {groups.length > COLLAPSED_GROUPS && (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex h-12 items-center gap-2 rounded-lg border border-muted px-14 text-sm font-medium transition-colors hover:border-ink"
          >
            {expanded ? "View Less" : "View More"}
            <ChevronDown className={cn("size-5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
