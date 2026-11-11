import type { ReactNode } from "react";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SupportChat } from "@/components/chat/support-chat";
import { getNavigationCategories } from "@/server/catalog/catalog.service";

export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const categories = await getNavigationCategories();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <SiteHeader categories={categories} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter />
      <CartDrawer />
      <SupportChat />
    </>
  );
}
