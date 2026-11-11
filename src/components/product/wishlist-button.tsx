"use client";

import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useWishlist } from "@/hooks/use-wishlist";
import { cn } from "@/lib/utils";

/** Optimistic heart toggle (server for signed-in users, localStorage for guests). */
export function WishlistButton({ productId, productName, className }: { productId: string; productName: string; className?: string }) {
  const wishlist = useWishlist();
  const saved = wishlist.has(productId);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        wishlist.toggle(productId);
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${productName} from wishlist` : `Save ${productName} to wishlist`}
      className={cn("flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white", className)}
    >
      <motion.span key={String(saved)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
        <Heart className={cn("size-6", saved ? "fill-heart text-heart" : "text-muted")} strokeWidth={1.75} />
      </motion.span>
    </button>
  );
}
