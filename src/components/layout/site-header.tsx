"use client";

import { Heart, Menu, ShoppingCart, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/hooks/use-cart";
import { useSession } from "@/hooks/use-session";
import { useWishlist } from "@/hooks/use-wishlist";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { CategoryLink } from "@/types/catalog";
import { CategoryIcon } from "@/components/shared/icons";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Logo } from "./logo";
import { SearchAutocomplete } from "./search-autocomplete";

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Catalog" },
  { href: "/deals", label: "Deals" },
  { href: "/support", label: "Support" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white"
      aria-label={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function HeaderActions() {
  const { data: cart } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { data: session } = useSession();
  const setCartOpen = useUiStore((state) => state.setCartOpen);
  const itemCount = cart?.itemCount ?? 0;

  return (
    <div className="flex items-center gap-5 lg:gap-6">
      <Link href="/wishlist" className="relative hidden p-0.5 sm:block" aria-label={`Wishlist (${wishlistCount} items)`}>
        <Heart className="size-6" strokeWidth={1.75} />
        <CountBadge count={wishlistCount} label={`${wishlistCount} saved`} />
      </Link>
      <button type="button" onClick={() => setCartOpen(true)} className="relative p-0.5" aria-label={`Open cart (${itemCount} items)`}>
        <ShoppingCart className="size-6" strokeWidth={1.75} />
        <CountBadge count={itemCount} label={`${itemCount} in cart`} />
      </button>
      <Link href={session ? "/account" : "/login"} className="hidden p-0.5 sm:block" aria-label={session ? "Your account" : "Sign in"}>
        <User className="size-6" strokeWidth={1.75} />
      </Link>
    </div>
  );
}

export function SiteHeader({ categories }: { categories: CategoryLink[] }) {
  const pathname = usePathname();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="border-b border-line-2">
        <div className="container-site flex h-[72px] items-center gap-6 lg:h-[88px] lg:gap-10">
          <Logo />
          <SearchAutocomplete className="hidden w-full max-w-[372px] md:block" />
          <nav aria-label="Primary" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-12">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive(pathname, link.href) ? "page" : undefined}
                    className={cn("text-base transition-colors hover:text-ink", isActive(pathname, link.href) ? "font-medium text-ink" : "text-ink/30")}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-5 lg:ml-0">
            <HeaderActions />
            <button type="button" className="p-0.5 lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
              <Menu className="size-6" />
            </button>
          </div>
        </div>
        <div className="container-site pb-3 md:hidden">
          <SearchAutocomplete />
        </div>
      </div>

      {/* Desktop category sub-header */}
      <nav aria-label="Categories" className="hidden bg-subnav md:block">
        <ul className="container-site flex h-12 items-center justify-between">
          {categories.map((category, index) => (
            <li key={category.slug} className="flex flex-1 items-center">
              <Link
                href={`/catalog/${category.slug}`}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 text-base text-white/60 transition-colors hover:text-white",
                  pathname.startsWith(`/catalog/${category.slug}`) && "text-white",
                )}
              >
                <CategoryIcon iconKey={category.iconKey} className="size-6" />
                {category.name}
              </Link>
              {index < categories.length - 1 && <span className="h-6 w-px bg-white/25" aria-hidden />}
            </li>
          ))}
        </ul>
      </nav>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" title="Menu" className="max-w-[320px]">
          <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-6 py-4">
            <ul className="space-y-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMobileNavOpen(false)}
                    className={cn("block rounded-md px-3 py-3 text-lg", isActive(pathname, link.href) ? "bg-surface font-medium" : "text-ink/70")}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mb-2 mt-6 px-3 text-xs font-medium uppercase tracking-wide text-muted">Categories</p>
            <ul className="space-y-1">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/catalog/${category.slug}`}
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-2.5 text-base text-ink/80 hover:bg-surface"
                  >
                    <CategoryIcon iconKey={category.iconKey} className="size-5" />
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="grid grid-cols-2 gap-3 border-t border-line p-6">
            <Link href="/wishlist" onClick={() => setMobileNavOpen(false)} className="flex items-center justify-center gap-2 rounded-md border border-line-2 py-3 text-sm">
              <Heart className="size-4" /> Wishlist
            </Link>
            <Link
              href={session ? "/account" : "/login"}
              onClick={() => setMobileNavOpen(false)}
              className="flex items-center justify-center gap-2 rounded-md bg-ink py-3 text-sm text-white"
            >
              <User className="size-4" /> {session ? "Account" : "Sign in"}
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
