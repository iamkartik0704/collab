import { ChevronRight } from "lucide-react";
import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="py-6 lg:py-10">
      <ol className="flex flex-wrap items-center gap-2 text-sm lg:gap-4 lg:text-base">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2 lg:gap-4">
              {item.href && !last ? (
                <Link href={item.href} className="text-muted transition-colors hover:text-ink">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-ink" : "text-muted"}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="size-4 text-muted" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
