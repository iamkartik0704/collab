import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, json, readJson, route } from "@/lib/api/handler";
import { SECURE_COOKIES } from "@/lib/auth/cookies";
import { getAuthState } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { RateLimitPolicies } from "@/lib/redis";
import { getClientIp } from "@/lib/security/request";
import { runAgentTurn, type AgentEvent } from "@/server/ai/agent";
import { assistantActive, CHAT_COOKIE, createSession, findOwnedSession, guestHash, loadTranscript, newGuestToken, storeCustomerMessage, type ChatIdentity } from "@/server/ai/chat.service";
import { MAX_USER_MESSAGE_CHARS } from "@/server/ai/guardrails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const COOKIE_NAME = SECURE_COOKIES ? `__Secure-${CHAT_COOKIE}` : CHAT_COOKIE;

async function identify(request: NextRequest): Promise<ChatIdentity> {
  const state = await getAuthState();
  const token = request.cookies.get(COOKIE_NAME)?.value ?? null;
  return { user: state.status === "authenticated" ? { id: state.user.id, name: state.user.name, email: state.user.email } : null, guestToken: token };
}

function cookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/api/ai; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${SECURE_COOKIES ? "; Secure" : ""}`;
}

const getSchema = z.object({ sessionId: z.string().min(10).max(40) });

/** GET /api/ai/chat?sessionId= - the visible transcript and status (the widget polls it during a hand-off). */
export const GET = route(async (request) => {
  const { sessionId } = getSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const session = await findOwnedSession(sessionId, await identify(request));
  const messages = (await loadTranscript(session.id)).map(({ id, role, text, author, createdAt }) => ({ id, role, text, author, createdAt }));
  return json({ sessionId: session.id, status: session.status, ticketNumber: session.ticket?.ticketNumber ?? null, messages });
});

const postSchema = z.object({
  sessionId: z.string().min(10).max(40).nullable().optional(),
  message: z.string().min(1).max(MAX_USER_MESSAGE_CHARS * 2),
});

/**
 * POST /api/ai/chat { sessionId?, message } - stores the message and streams the assistant's
 * reply as Server-Sent Events: session, delta, reset, tool, handoff, waiting, error, done.
 */
export const POST = route(async (request) => {
  const body = await readJson(request, postSchema, { maxBytes: 16 * 1024 });
  const identity = await identify(request);
  let setCookie: string | null = null;
  let tokenHash = guestHash(identity.guestToken);
  if (!tokenHash) {
    const fresh = newGuestToken();
    identity.guestToken = fresh.token;
    tokenHash = fresh.hash;
    setCookie = cookieHeader(fresh.token);
  }
  await enforceRateLimit(RateLimitPolicies.aiChat, identity.user ? `user:${identity.user.id}` : `guest:${tokenHash}`);
  await enforceRateLimit(RateLimitPolicies.publicApi, `ai-chat-ip:${getClientIp(request.headers)}`);

  let session = body.sessionId ? await findOwnedSession(body.sessionId, identity).catch(() => null) : null;
  if (!session || session.status === "CLOSED") session = await createSession(identity, tokenHash);
  await storeCustomerMessage(session.id, body.message);
  const activeSession = session;

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send("session", { sessionId: activeSession.id, status: activeSession.status, ticketNumber: activeSession.ticket?.ticketNumber ?? null });

      try {
        if (!assistantActive(activeSession.status)) {
          // A person is handling the conversation: the message is queued for them.
          send("waiting", { message: "A member of our support team will reply here shortly." });
          send("done", { messageId: null });
        } else {
          const messageId = await runAgentTurn({
            sessionId: activeSession.id,
            user: identity.user,
            signal: abort.signal,
            emit: (event: AgentEvent) => {
              const { type, ...data } = event;
              send(type, data);
            },
          });
          send("done", { messageId });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          logger.error({ err: error, sessionId: activeSession.id }, "support agent turn failed");
          const unavailable = error instanceof Anthropic.APIError;
          send("error", {
            message: unavailable
              ? "Our assistant is unavailable right now. Please try again in a minute, or email support@collab.store and we'll help you."
              : "Something went wrong while answering. Please try again.",
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // client already gone
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(stream, { headers });
});
