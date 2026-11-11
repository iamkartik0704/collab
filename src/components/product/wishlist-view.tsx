"use client";

import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import Link from "next/link";
import { useWishlist } from "@/hooks/use-wishlist";
import { apiFetch } from "@/lib/api-client";
import type { ProductCardData } from "@/types/catalog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { ProductGrid } from "./product-card";

export function WishlistView() {
  const { productIds } = useWishlist();
  const key = [...productIds].sort().join(",");
  const { data, isLoading } = useQuery({
    queryKey: ["wishlist-cards", key],
    queryFn: () => apiFetch<{ products: ProductCardData[] }>(`/api/products/cards?ids=${productIds.slice(0, 50).join(",")}`).then((d) => d.products),
    enabled: productIds.length > 0,
    placeholderData: (previous) => previous,
  });
  const products = (data ?? []).filter((product) => productIds.includes(product.id));

  return (
    <div className="container-site py-14">
      <h1 className="text-2xl font-semibold">Wishlist</h1>
      {productIds.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-surface py-20 text-center">
          <Heart className="size-12 text-line-2" strokeWidth={1.25} />
          <p className="text-lg font-medium">Nothing saved yet</p>
          <p className="text-sm text-muted-2">Tap the heart on any product to keep it here.</p>
          <Button asChild variant="outline">
            <Link href="/catalog">Browse the catalog</Link>
          </Button>
        </div>
      ) : isLoading && !data ? (
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {productIds.slice(0, 4).map((id) => (
            <Skeleton key={id} className="h-[432px]" />
          ))}
        </div>
      ) : (
        <div className="mt-8">
          <ProductGrid products={products} />
        </div>
      )}
    </div>
  );
}
