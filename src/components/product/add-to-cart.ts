"use client";

import { useState } from "react";
import { useCartMutations } from "@/hooks/use-cart";
import { ApiClientError } from "@/lib/api-client";
import { useUiStore } from "@/stores/ui-store";

/** Adds a variant and opens the cart drawer; surfaces stock / limit errors inline. */
export function useAddToCart() {
  const { addItem } = useCartMutations();
  const setCartOpen = useUiStore((state) => state.setCartOpen);
  const [error, setError] = useState<string | null>(null);

  const add = (variantId: string, quantity = 1) => {
    setError(null);
    addItem.mutate(
      { variantId, quantity },
      {
        onSuccess: () => setCartOpen(true),
        onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Could not add to cart."),
      },
    );
  };

  return { add, pending: addItem.isPending, error, clearError: () => setError(null) };
}
