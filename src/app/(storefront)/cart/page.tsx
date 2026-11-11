import type { Metadata } from "next";
import { CartPageView } from "@/components/cart/cart-page-view";

export const metadata: Metadata = { title: "Shopping Cart", robots: { index: false } };

export default function CartPage() {
  return <CartPageView />;
}
