"use client";

import { BarChart3, ClipboardList, ExternalLink, Headset, Menu, Package, ScrollText, Ticket, Warehouse, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: "dashboard" | "products" | "inventory" | "orders" | "support" | "coupons" | "audit";
}

const ICONS = {
  dashboard: BarChart3,
  products: Package,
  inventory: Warehouse,
  orders: ClipboardList,
  support: Headset,
  coupons: Ticket,
  audit: ScrollText,
} as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ items, pathname, onNavigate }: { items: AdminNavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-white text-ink" : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Admin chrome: dark sidebar (desktop), slide-over menu (mobile), top bar with identity. */
export function AdminShell({ items, user, children }: { items: AdminNavItem[]; user: { name: string | null; email: string | null; role: string }; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const roleLabel = user.role.toLowerCase().replace(/_/g, " ");

  const brand = (
    <Link href="/admin" className="flex items-center gap-2 px-3 text-lg font-semibold text-white">
      Collab <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest">Admin</span>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-tint-1 lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 bg-hero px-3 py-5 lg:flex">
        {brand}
        <nav aria-label="Admin">
          <NavList items={items} pathname={pathname} />
        </nav>
        <div className="mt-auto space-y-3 px-3 text-xs text-white/60">
          <Link href="/" className="flex items-center gap-1.5 hover:text-white">
            <ExternalLink className="size-3.5" aria-hidden /> View storefront
          </Link>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 bg-hero px-3 py-5">
            <div className="flex items-center justify-between">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-white" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <nav aria-label="Admin">
              <NavList items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="rounded p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right leading-tight">
              <p className="text-sm font-medium">{user.name ?? user.email}</p>
              <p className="text-xs capitalize text-muted-2">{roleLabel}</p>
            </div>
            <SignOutButton />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
