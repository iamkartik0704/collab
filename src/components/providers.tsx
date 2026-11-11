"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useWishlistSync } from "@/hooks/use-wishlist";
import { ApiClientError } from "@/lib/api-client";

function WishlistSync() {
  useWishlistSync();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Never retry client errors (4xx); retry transient failures once.
            retry: (failureCount, error) => !(error instanceof ApiClientError && error.status < 500) && failureCount < 1,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <WishlistSync />
      {children}
    </QueryClientProvider>
  );
}
