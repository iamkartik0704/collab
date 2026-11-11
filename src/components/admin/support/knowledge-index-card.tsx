"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/admin/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface IndexStatus {
  chunks: number;
  embeddedChunks: number;
  products: number;
  embeddedProducts: number;
  lastUpdatedAt: string | null;
}

/** RAG index coverage + "rebuild" (queues reindex-all in the worker, which backfills embeddings). */
export function KnowledgeIndexCard({ initial }: { initial: IndexStatus }) {
  const status = useQuery({
    queryKey: ["admin-ai-index"],
    queryFn: () => apiFetch<IndexStatus>("/api/admin/ai/reindex"),
    initialData: initial,
    refetchInterval: (query) => (query.state.data && query.state.data.embeddedChunks < query.state.data.chunks ? 10_000 : false),
  });
  const rebuild = useMutation({ mutationFn: () => apiFetch<{ queued: boolean }>("/api/admin/ai/reindex", { method: "POST" }), onSuccess: () => void status.refetch() });
  const data = status.data;
  const complete = data.chunks > 0 && data.embeddedChunks === data.chunks && data.embeddedProducts === data.products;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-white px-5 py-4">
      <div className="flex items-start gap-3">
        <DatabaseZap className="mt-0.5 size-5 text-muted-2" aria-hidden />
        <div>
          <p className="text-sm font-semibold">AI knowledge base</p>
          <p className="text-xs text-muted-2">
            {data.embeddedChunks}/{data.chunks} help-centre & product passages and {data.embeddedProducts}/{data.products} products have embeddings
            {data.lastUpdatedAt ? ` · updated ${relativeTime(data.lastUpdatedAt)}` : ""}.
            {!complete && " Missing embeddings fall back to keyword search; rebuild after adding the VOYAGE_API_KEY."}
          </p>
          {rebuild.isSuccess && <p className="mt-1 text-xs text-success">Rebuild queued. The worker processes it in the background.</p>}
          {rebuild.error && <p className="mt-1 text-xs text-danger">{rebuild.error instanceof ApiClientError ? rebuild.error.message : "Could not queue the rebuild."}</p>}
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => rebuild.mutate()} loading={rebuild.isPending}>
        Rebuild & backfill embeddings
      </Button>
    </div>
  );
}
