"use client";

import { useQuery } from "@tanstack/react-query";

export interface ClientSession {
  user: { id: string; role: string; name?: string | null; email?: string | null; image?: string | null };
  accessExpiresAt: number;
}

async function fetchSession(): Promise<ClientSession | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as ClientSession | Record<string, never> | null;
  return data && "user" in data && data.user?.id ? (data as ClientSession) : null;
}

/** Current session (null for guests). Re-fetched after sign-in / sign-out via invalidation. */
export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: fetchSession, staleTime: 60_000 });
}
