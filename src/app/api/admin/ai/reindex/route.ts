import { json, route } from "@/lib/api/handler";
import { enqueueKnowledgeReindex } from "@/queues";
import { writeAudit } from "@/server/admin/audit";
import { requireAdmin } from "@/server/admin/context";
import { knowledgeIndexStatus } from "@/server/ai/rag";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/admin/ai/reindex - RAG index coverage (chunks / products with embeddings). */
export const GET = route(async (request, { requestId }) => {
  await requireAdmin(request, "ai:manage", requestId, { write: false });
  return json(await knowledgeIndexStatus());
});

/** POST /api/admin/ai/reindex - queues a full rebuild + embedding backfill (runs in the worker). */
export const POST = route(async (request, { requestId }) => {
  const ctx = await requireAdmin(request, "ai:manage", requestId);
  await enqueueKnowledgeReindex();
  await withTransaction((tx) => writeAudit(tx, ctx, { action: "BULK_IMPORT", entityType: "KnowledgeIndex", entityId: "all", reason: "AI knowledge base reindex requested" }));
  return json({ queued: true, status: await knowledgeIndexStatus() }, { status: 202 });
});
