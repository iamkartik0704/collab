"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoryLink } from "@/types/catalog";
import { CategoryIcon } from "@/components/shared/icons";

/** "Browse By Category": 160x128 #EDEDED cards, scroll-snap carousel with arrow controls. */
export function CategoryCarousel({ categories }: { categories: CategoryLink[] }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges({ start: track.scrollLeft <= 4, end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateEdges]);

  const scrollBy = (direction: -1 | 1) => trackRef.current?.scrollBy({ left: direction * 192 * 2, behavior: "smooth" });

  return (
    <section aria-labelledby="browse-categories" className="container-site py-14 lg:py-20">
      <div className="mb-8 flex items-center justify-between">
        <h2 id="browse-categories" className="text-2xl font-medium">
          Browse By Category
        </h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => scrollBy(-1)} disabled={edges.start} aria-label="Previous categories" className="p-1 transition-opacity disabled:opacity-30">
            <ChevronLeft className="size-8" strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => scrollBy(1)} disabled={edges.end} aria-label="Next categories" className="p-1 transition-opacity disabled:opacity-30">
            <ChevronRight className="size-8" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <ul ref={trackRef} onScroll={updateEdges} className="flex snap-x snap-mandatory gap-4 overflow-x-auto scrollbar-none lg:gap-8">
        {categories.map((category) => (
          <li key={category.slug} className="snap-start">
            <Link
              href={`/catalog/${category.slug}`}
              className="flex h-32 w-[160px] flex-col items-center justify-center gap-2 rounded-[15px] bg-surface-2 transition-colors hover:bg-[#e2e2e2]"
            >
              <CategoryIcon iconKey={category.iconKey} className="size-12" />
              <span className="text-base font-medium">{category.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
