"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Guest wishlist, persisted in localStorage and merged into the account on sign-in. */
interface GuestWishlistState {
  productIds: string[];
  toggle: (productId: string) => void;
  clear: () => void;
}

export const useGuestWishlist = create<GuestWishlistState>()(
  persist(
    (set) => ({
      productIds: [],
      toggle: (productId) =>
        set((state) => ({
          productIds: state.productIds.includes(productId)
            ? state.productIds.filter((id) => id !== productId)
            : [productId, ...state.productIds].slice(0, 200),
        })),
      clear: () => set({ productIds: [] }),
    }),
    { name: "collab-wishlist", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);
