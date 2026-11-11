"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useGuestWishlist } from "@/stores/wishlist-store";
import { useSession } from "./use-session";

const WISHLIST_KEY = ["wishlist"] as const;
type WishlistResponse = { productIds: string[] };

/**
 * One wishlist API for the whole UI: server-backed for signed-in users, localStorage for
 * guests. Toggling is optimistic (the heart flips instantly and rolls back on failure).
 */
export function useWishlist() {
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const queryClient = useQueryClient();
  const guest = useGuestWishlist();

  const server = useQuery({
    queryKey: WISHLIST_KEY,
    queryFn: () => apiFetch<WishlistResponse>("/api/wishlist").then((data) => data.productIds),
    enabled: signedIn,
    staleTime: 60_000,
  });

  const toggleServer = useMutation({
    mutationFn: ({ productId, add }: { productId: string; add: boolean }) =>
      add
        ? apiFetch<WishlistResponse>("/api/wishlist", { method: "POST", body: { productId } })
        : apiFetch<WishlistResponse>(`/api/wishlist/${productId}`, { method: "DELETE" }),
    onMutate: async ({ productId, add }) => {
      await queryClient.cancelQueries({ queryKey: WISHLIST_KEY });
      const previous = queryClient.getQueryData<string[]>(WISHLIST_KEY) ?? [];
      queryClient.setQueryData<string[]>(WISHLIST_KEY, add ? [productId, ...previous] : previous.filter((id) => id !== productId));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context) queryClient.setQueryData(WISHLIST_KEY, context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(WISHLIST_KEY, data.productIds),
  });

  const serverIds = server.data;
  const productIds = useMemo(() => (signedIn ? (serverIds ?? []) : guest.productIds), [signedIn, serverIds, guest.productIds]);

  const toggle = useCallback(
    (productId: string) => {
      if (signedIn) {
        toggleServer.mutate({ productId, add: !productIds.includes(productId) });
      } else {
        guest.toggle(productId);
      }
    },
    [signedIn, productIds, toggleServer, guest],
  );

  return { productIds, has: (productId: string) => productIds.includes(productId), toggle, count: productIds.length };
}

/** Mount once: when a guest signs in, push their local wishlist to the account and clear it. */
export function useWishlistSync() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const localIds = useGuestWishlist((state) => state.productIds);
  const clear = useGuestWishlist((state) => state.clear);
  const syncing = useRef(false);

  useEffect(() => {
    if (!session || localIds.length === 0 || syncing.current) return;
    syncing.current = true;
    apiFetch<WishlistResponse>("/api/wishlist/sync", { method: "POST", body: { productIds: localIds } })
      .then((data) => {
        queryClient.setQueryData(WISHLIST_KEY, data.productIds);
        clear();
      })
      .catch(() => undefined)
      .finally(() => {
        syncing.current = false;
      });
  }, [session, localIds, clear, queryClient]);
}
