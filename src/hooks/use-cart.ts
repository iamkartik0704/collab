"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { PricedCart } from "@/server/cart/pricing";

export type CartView = PricedCart;
type CartResponse = { cart: CartView };

export const CART_KEY = ["cart"] as const;

/** Server-priced cart. Every mutation returns the re-priced cart, written straight to the cache. */
export function useCart(shippingMethodCode?: string | null) {
  return useQuery({
    queryKey: shippingMethodCode ? [...CART_KEY, shippingMethodCode] : CART_KEY,
    queryFn: () =>
      apiFetch<CartResponse>(shippingMethodCode ? `/api/cart?shipping=${encodeURIComponent(shippingMethodCode)}` : "/api/cart").then(
        (data) => data.cart,
      ),
    staleTime: 15_000,
  });
}

export function useCartMutations() {
  const queryClient = useQueryClient();
  const apply = (data: CartResponse) => {
    queryClient.setQueryData(CART_KEY, data.cart);
    // Priced-with-shipping variants (checkout) re-fetch with the new contents.
    void queryClient.invalidateQueries({ queryKey: CART_KEY, predicate: (query) => query.queryKey.length > 1 });
  };

  const addItem = useMutation({
    mutationFn: (input: { variantId: string; quantity: number }) =>
      apiFetch<CartResponse>("/api/cart/items", { method: "POST", body: input }),
    onSuccess: apply,
  });

  const setQuantity = useMutation({
    mutationFn: (input: { variantId: string; quantity: number }) =>
      apiFetch<CartResponse>(`/api/cart/items/${input.variantId}`, { method: "PATCH", body: { quantity: input.quantity } }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: CART_KEY });
      const previous = queryClient.getQueryData<CartView>(CART_KEY);
      if (previous) {
        queryClient.setQueryData<CartView>(CART_KEY, {
          ...previous,
          lines: previous.lines.map((line) => (line.variantId === input.variantId ? { ...line, quantity: input.quantity } : line)),
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
    },
    onSuccess: apply,
  });

  const removeItem = useMutation({
    mutationFn: (variantId: string) => apiFetch<CartResponse>(`/api/cart/items/${variantId}`, { method: "DELETE" }),
    onMutate: async (variantId) => {
      await queryClient.cancelQueries({ queryKey: CART_KEY });
      const previous = queryClient.getQueryData<CartView>(CART_KEY);
      if (previous) {
        queryClient.setQueryData<CartView>(CART_KEY, { ...previous, lines: previous.lines.filter((line) => line.variantId !== variantId) });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
    },
    onSuccess: apply,
  });

  const applyCoupon = useMutation({
    mutationFn: (code: string) => apiFetch<CartResponse>("/api/cart/coupon", { method: "POST", body: { code } }),
    onSuccess: apply,
  });

  const removeCoupon = useMutation({
    mutationFn: () => apiFetch<CartResponse>("/api/cart/coupon", { method: "DELETE" }),
    onSuccess: apply,
  });

  return { addItem, setQuantity, removeItem, applyCoupon, removeCoupon };
}
