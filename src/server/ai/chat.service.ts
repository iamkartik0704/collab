import type { ChatSessionStatus, Prisma } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { hmacSha256Hex, randomToken } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { writeAudit } from "@/server/admin/audit";
import type { AdminContext } from "@/server/admin/context";
import { inspectUserMessage, redactSensitive } from "./guardrails";

/**
 * Chat sessions for the support widget. Signed-in customers own sessions by user id; guests by
 * an HttpOnly cookie token (only its HMAC is stored). A guest session is claimed by the
 * customer when they sign in and keep chatting.
 */

export const CHAT_COOKIE = "collab.chat";

export interface ChatIdentity {
  user: { id: string; name: string | null; email: string | null } | null;
  /** Raw cookie token (guests and signed-in users both get one). */
  guestToken: string | null;
}

export function newGuestToken(): { token: string; hash: string } {
  const token = randomToken(24);
  return { token, hash: hmacSha256Hex(`chat:${token}`) };
}

export function guestHash(token: string | null): string | null {
  return token && /^[A-Za-z0-9_-]{20,64}$/.test(token) ? hmacSha256Hex(`chat:${token}`) : null;
}

/** The caller's session `sessionId`, or a 404 that does not reveal whether it exists. */
export async function findOwnedSession(sessionId: string, identity: ChatIdentity) {
  const session = await db.chatSession.findUnique({ where: { id: sessionId }, include: { ticket: { select: { ticketNumber: true, status: true } } } });
  const hash = guestHash(identity.guestToken);
  if (!session) throw Errors.notFound("Conversation");
  const ownsAsUser = identity.user && session.customerId === identity.user.id;
  const ownsAsGuest = hash && session.guestToken === hash && (session.customerId === null || session.customerId === identity.user?.id);
  if (!ownsAsUser && !ownsAsGuest) throw Errors.notFound("Conversation");
  if (identity.user && !session.customerId) {
    await db.chatSession.update({ where: { id: session.id }, data: { customerId: identity.user.id } });
  }
  return session;
}

export async function createSession(identity: ChatIdentity, guestTokenHash: string) {
  return db.chatSession.create({ data: { customerId: identity.user?.id ?? null, guestToken: guestTokenHash }, include: { ticket: { select: { ticketNumber: true, status: true } } } });
}

/** What the customer (or staff) sees: customer, assistant and human-agent text only. */
export async function loadTranscript(sessionId: string, options: { includeTools?: boolean } = {}) {
  const rows = await db.chatMessage.findMany({
    where: { sessionId, role: { in: options.includeTools ? ["USER", "ASSISTANT", "HUMAN_AGENT", "TOOL"] : ["USER", "ASSISTANT", "HUMAN_AGENT"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { author: { select: { name: true } } },
  });
  return rows
    .filter((row) => row.role === "TOOL" || row.content.trim().length > 0)
    .map((row) => ({
      id: row.id,
      role: row.role === "USER" ? ("customer" as const) : row.role === "HUMAN_AGENT" ? ("agent" as const) : row.role === "TOOL" ? ("tool" as const) : ("assistant" as const),
      text: row.content,
      author: row.role === "HUMAN_AGENT" ? (row.author?.name?.split(" ")[0] ?? "Collab support") : null,
      createdAt: row.createdAt.toISOString(),
      flagged: row.flagged,
      tool: row.role === "TOOL" ? { input: row.toolInput, output: row.toolOutput } : undefined,
    }));
}

export type TranscriptMessage = Awaited<ReturnType<typeof loadTranscript>>[number];

/** Stores the customer's message (normalised, sensitive data removed). */
export async function storeCustomerMessage(sessionId: string, raw: string): Promise<{ id: string; flagged: boolean }> {
  const guard = inspectUserMessage(raw);
  if (!guard.text) throw Errors.badRequest("empty_message", "Type a message first.");
  const text = redactSensitive(guard.text);
  const [message] = await db.$transaction([
    db.chatMessage.create({ data: { sessionId, role: "USER", content: text, apiContent: [{ type: "text", text }] as Prisma.InputJsonValue, flagged: guard.flagged }, select: { id: true } }),
    db.chatSession.update({ where: { id: sessionId }, data: { lastMessageAt: new Date(), ...(guard.flagged ? { flaggedReason: guard.reason } : {}) } }),
  ]);
  return { id: message.id, flagged: guard.flagged };
}

/** The assistant answers unless a person has taken the conversation over (or it is closed). */
export function assistantActive(status: ChatSessionStatus): boolean {
  return status === "ACTIVE" || status === "ESCALATED";
}

// ============================================================================ staff inbox

export async function listInbox(filter: "open" | "takeover" | "all") {
  const statuses: ChatSessionStatus[] | null = filter === "open" ? ["ESCALATED", "HUMAN_TAKEOVER"] : filter === "takeover" ? ["HUMAN_TAKEOVER"] : null;
  const sessions = await db.chatSession.findMany({
    where: statuses ? { status: { in: statuses } } : { messages: { some: {} } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true, email: true } },
      takenOverBy: { select: { name: true } },
      ticket: { select: { ticketNumber: true, subject: true, priority: true, status: true, category: true } },
      messages: { where: { role: { in: ["USER", "ASSISTANT", "HUMAN_AGENT"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
      _count: { select: { messages: { where: { role: "USER" } } } },
    },
  });
  return sessions.map((session) => ({
    id: session.id,
    status: session.status,
    customer: session.customer?.name ?? session.customer?.email ?? "Guest",
    takenOverBy: session.takenOverBy?.name ?? null,
    ticket: session.ticket,
    flagged: Boolean(session.flaggedReason),
    lastMessage: session.messages[0] ? { role: session.messages[0].role, text: session.messages[0].content.slice(0, 140) } : null,
    customerMessages: session._count.messages,
    lastMessageAt: session.lastMessageAt.toISOString(),
    escalatedAt: session.escalatedAt?.toISOString() ?? null,
  }));
}

export async function getInboxSession(sessionId: string) {
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      takenOverBy: { select: { id: true, name: true } },
      ticket: { include: { order: { select: { orderNumber: true } } } },
    },
  });
  if (!session) return null;
  return { session, transcript: await loadTranscript(sessionId, { includeTools: true }) };
}

export async function takeOver(ctx: AdminContext, sessionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const session = await tx.chatSession.findUnique({ where: { id: sessionId }, select: { status: true, takenOverById: true } });
    if (!session) throw Errors.notFound("Conversation");
    if (session.status === "CLOSED") throw Errors.conflict("closed", "This conversation is closed.");
    if (session.status === "HUMAN_TAKEOVER" && session.takenOverById && session.takenOverById !== ctx.actor.id) {
      throw Errors.conflict("already_taken", "Another agent is handling this conversation.");
    }
    await tx.chatSession.update({ where: { id: sessionId }, data: { status: "HUMAN_TAKEOVER", takenOverById: ctx.actor.id, takenOverAt: new Date() } });
    await tx.supportTicket.updateMany({ where: { chatSessionId: sessionId, status: "OPEN" }, data: { status: "IN_PROGRESS", assignedToId: ctx.actor.id } });
    await writeAudit(tx, ctx, { action: "CHAT_TAKEOVER", entityType: "ChatSession", entityId: sessionId, before: { status: session.status }, after: { status: "HUMAN_TAKEOVER" } });
  });
}

export async function replyAsAgent(ctx: AdminContext, sessionId: string, text: string): Promise<void> {
  const body = text.trim().slice(0, 4000);
  if (!body) throw Errors.badRequest("empty_message", "Type a reply first.");
  const session = await db.chatSession.findUnique({ where: { id: sessionId }, select: { status: true, takenOverById: true } });
  if (!session) throw Errors.notFound("Conversation");
  if (session.status !== "HUMAN_TAKEOVER" || session.takenOverById !== ctx.actor.id) {
    throw Errors.conflict("not_taken_over", "Take over the conversation before replying.");
  }
  await db.$transaction([
    db.chatMessage.create({ data: { sessionId, role: "HUMAN_AGENT", content: body, authorId: ctx.actor.id } }),
    db.chatSession.update({ where: { id: sessionId }, data: { lastMessageAt: new Date() } }),
  ]);
}

/** Hands the conversation back to the assistant (e.g. the agent's part is done). */
export async function releaseToAssistant(ctx: AdminContext, sessionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const session = await tx.chatSession.findUnique({ where: { id: sessionId }, select: { status: true } });
    if (!session) throw Errors.notFound("Conversation");
    if (session.status !== "HUMAN_TAKEOVER") throw Errors.conflict("not_taken_over", "The assistant is already handling this conversation.");
    await tx.chatSession.update({ where: { id: sessionId }, data: { status: "ESCALATED", takenOverById: null } });
    await writeAudit(tx, ctx, { action: "CHAT_TAKEOVER", entityType: "ChatSession", entityId: sessionId, before: { status: "HUMAN_TAKEOVER" }, after: { status: "ESCALATED" }, reason: "handed back to the assistant" });
  });
}

export async function resolveConversation(ctx: AdminContext, sessionId: string, note: string | null): Promise<void> {
  await withTransaction(async (tx) => {
    const session = await tx.chatSession.findUnique({ where: { id: sessionId }, select: { status: true } });
    if (!session) throw Errors.notFound("Conversation");
    await tx.chatSession.update({ where: { id: sessionId }, data: { status: "CLOSED" } });
    await tx.supportTicket.updateMany({ where: { chatSessionId: sessionId, status: { notIn: ["RESOLVED", "CLOSED"] } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await tx.adminAlert.updateMany({ where: { type: "SUPPORT_ESCALATION", entityId: sessionId, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedById: ctx.actor.id } });
    await writeAudit(tx, ctx, { action: "UPDATE", entityType: "ChatSession", entityId: sessionId, before: { status: session.status }, after: { status: "CLOSED" }, reason: note ?? "conversation resolved" });
  });
}
