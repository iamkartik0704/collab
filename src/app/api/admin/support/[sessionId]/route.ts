import { z } from "zod";
import { json, readJson, route } from "@/lib/api/handler";
import { releaseToAssistant, replyAsAgent, resolveConversation, takeOver } from "@/server/ai/chat.service";
import { requireAdmin } from "@/server/admin/context";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("takeover") }),
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("resolve"), note: z.string().trim().max(500).nullable().optional() }),
]);

/** POST /api/admin/support/:sessionId { action: takeover | reply | release | resolve } */
export const POST = route<{ sessionId: string }>(async (request, { params, requestId }) => {
  const ctx = await requireAdmin(request, "support:inbox", requestId);
  const body = await readJson(request, actionSchema);
  switch (body.action) {
    case "takeover":
      await takeOver(ctx, params.sessionId);
      break;
    case "reply":
      await replyAsAgent(ctx, params.sessionId, body.text);
      break;
    case "release":
      await releaseToAssistant(ctx, params.sessionId);
      break;
    case "resolve":
      await resolveConversation(ctx, params.sessionId, body.note ?? null);
      break;
  }
  return json({ ok: true });
});
