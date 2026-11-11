import { AlertTriangle, CheckCircle2, CircleDot, Info, XCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

/** Building blocks shared by admin pages (server-renderable). */

export function PageHeader({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-2">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, className, children, bodyClassName }: { title?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {typeof title === "string" ? <h2 className="text-sm font-semibold">{title}</h2> : title}
          {actions}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted-2",
  info: "bg-[#e8f1fc] text-[#1c5cab]",
  success: "bg-[#e6f4ea] text-success",
  warning: "bg-[#fff4d6] text-[#8a5a00]",
  danger: "bg-[#fdecea] text-danger",
};

const TONE_ICONS: Record<Tone, typeof Info> = {
  neutral: CircleDot,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/** Status chips always pair colour with an icon and a text label. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONE_CLASSES[tone], className)}>
      <Icon className="size-3" aria-hidden />
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-line-2">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-2">{children}</div>}
    </div>
  );
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <th scope="col" className={cn("border-b border-line bg-tint-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-2", ALIGN[align], className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle", ALIGN[align], className)}>{children}</td>;
}

/** Link-based pagination that preserves the current query string. */
export function Pagination({ page, pageCount, basePath, params }: { page: number; pageCount: number; basePath: string; params: Record<string, string | undefined> }) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
    if (target > 1) search.set("page", String(target));
    else search.delete("page");
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 px-1 pt-4 text-sm">
      <span className="text-muted-2">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded-md border border-line-2 px-3 py-1.5 hover:border-ink" rel="prev">
            Previous
          </Link>
        ) : (
          <span className="rounded-md border border-line px-3 py-1.5 text-muted">Previous</span>
        )}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="rounded-md border border-line-2 px-3 py-1.5 hover:border-ink" rel="next">
            Next
          </Link>
        ) : (
          <span className="rounded-md border border-line px-3 py-1.5 text-muted">Next</span>
        )}
      </div>
    </nav>
  );
}

/** Underline tabs driven by links (URL is the state). */
export function LinkTabs({ items, active }: { items: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav aria-label="Views" className="-mb-px flex gap-6 overflow-x-auto border-b border-line scrollbar-none">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors",
            item.key === active ? "border-ink text-ink" : "border-transparent text-muted-2 hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-xs tabular-nums text-muted-2">{item.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export const selectClass =
  "h-10 rounded-[7px] border border-line-2 bg-white px-3 text-sm text-ink focus:border-ink focus:outline-none";
export const inputClass =
  "h-10 w-full rounded-[7px] border border-line-2 bg-white px-3 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none";
