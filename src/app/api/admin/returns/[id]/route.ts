import { json, readJson, route } from "@/lib/api/handler";
import { requireAdmin } from "@/server/admin/context";
import { decideReturnRequest, returnDecisionSchema } from "@/server/returns/return.service";

export const dynamic = "force-dynamic";

/** POST /api/admin/returns/:id { decision: "APPROVED" | "REJECTED", note } */
export const POST = route<{ id: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "orders:manage", requestId);
  await decideReturnRequest(ctx, params.id, await readJson(request, returnDecisionSchema));
  return json({ ok: true });
});
