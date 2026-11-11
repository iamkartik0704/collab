"use client";

import { Headset, Loader2, MessageCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Floating support chat. Messages stream from /api/ai/chat as Server-Sent Events over a POST
 * (EventSource cannot POST), parsed incrementally. During a human hand-off the transcript is
 * polled so the agent's replies appear without a reload.
 */

interface ChatLine {
  id: string;
  role: "customer" | "assistant" | "agent" | "system";
  text: string;
  author?: string | null;
  pending?: boolean;
}

type SessionStatus = "ACTIVE" | "ESCALATED" | "HUMAN_TAKEOVER" | "CLOSED";

const STORAGE_KEY = "collab.chat.session";
const OPEN_EVENT = "collab:open-support-chat";
const TOOL_LABEL: Record<string, string> = {
  search_help_center: "Checking our help centre…",
  search_products: "Looking up products…",
  get_order_status: "Looking up your order…",
  list_my_orders: "Fetching your orders…",
  escalate_to_human: "Connecting you with our team…",
};
const GREETING: ChatLine = { id: "greeting", role: "assistant", text: "Hi! I'm Collab's assistant. I can track an order, explain delivery, returns and warranty, or help you pick a product. How can I help?" };

/** Opens the widget from anywhere (e.g. the /support page). */
export function openSupportChat(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Renders /products/... links as links; everything else as text. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(\/products\/[a-z0-9-]+|\/catalog(?:\/[a-z0-9-]+)?|\/account|\/deals|https:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^(\/products\/|\/catalog|\/account|\/deals)/.test(part) ? (
          <Link key={index} href={part} className="underline underline-offset-2">
            {part}
          </Link>
        ) : /^https:\/\//.test(part) ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>("ACTIVE");
  const [ticket, setTicket] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadTranscript = useCallback(async (id: string) => {
    try {
      const data = await apiFetch<{ status: SessionStatus; ticketNumber: string | null; messages: Array<{ id: string; role: ChatLine["role"]; text: string; author: string | null }> }>(`/api/ai/chat?sessionId=${encodeURIComponent(id)}`);
      setStatus(data.status);
      setTicket(data.ticketNumber);
      if (data.status === "CLOSED") {
        window.localStorage.removeItem(STORAGE_KEY);
        setSessionId(null);
      }
      setLines([GREETING, ...data.messages]);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setSessionId(null);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setSessionId(stored);
      void loadTranscript(stored);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [loadTranscript]);

  // While a person is involved, poll for their replies.
  useEffect(() => {
    if (!open || !sessionId || busy || (status !== "HUMAN_TAKEOVER" && status !== "ESCALATED")) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadTranscript(sessionId);
    }, 5_000);
    return () => clearInterval(timer);
  }, [open, sessionId, busy, status, loadTranscript]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, activity]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const replyId = `reply-${Date.now()}`;
    setLines((current) => [...current, { id: `me-${Date.now()}`, role: "customer", text }, { id: replyId, role: "assistant", text: "", pending: true }]);
    const patchReply = (update: (line: ChatLine) => ChatLine) => setLines((current) => current.map((line) => (line.id === replyId ? update(line) : line)));

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ sessionId, message: text }),
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? (response.status === 429 ? "You're sending messages quickly. Please wait a moment." : "The assistant could not be reached."));
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const name = /^event: (.+)$/m.exec(frame)?.[1];
          const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
          if (!name || dataLine === undefined) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          switch (name) {
            case "session":
              if (typeof data.sessionId === "string") {
                setSessionId(data.sessionId);
                window.localStorage.setItem(STORAGE_KEY, data.sessionId);
              }
              if (typeof data.status === "string") setStatus(data.status as SessionStatus);
              break;
            case "delta":
              setActivity(null);
              patchReply((line) => ({ ...line, text: line.text + String(data.text ?? "") }));
              break;
            case "reset":
              patchReply((line) => ({ ...line, text: "" }));
              break;
            case "tool":
              setActivity(data.status === "running" ? (TOOL_LABEL[String(data.name)] ?? "Working on it…") : null);
              // Text before a tool call stays; the answer continues in the same bubble.
              patchReply((line) => (line.text && !line.text.endsWith("\n\n") && data.status === "running" ? { ...line, text: `${line.text}\n\n` } : line));
              break;
            case "handoff":
              setTicket(String(data.ticketNumber ?? ""));
              setStatus("ESCALATED");
              break;
            case "waiting":
              patchReply((line) => ({ ...line, role: "system", text: String(data.message ?? "") }));
              break;
            case "error":
              patchReply((line) => ({ ...line, role: "system", text: String(data.message ?? "Something went wrong.") }));
              break;
            case "done":
              patchReply((line) => ({ ...line, pending: false, text: line.text.trim() }));
              break;
          }
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted) patchReply((line) => ({ ...line, role: "system", text: failure instanceof Error ? failure.message : "Something went wrong." }));
    } finally {
      setLines((current) => current.filter((line) => !(line.id === replyId && !line.text)));
      setActivity(null);
      setBusy(false);
      abortRef.current = null;
    }
  }

  function startOver() {
    abortRef.current?.abort();
    window.localStorage.removeItem(STORAGE_KEY);
    setSessionId(null);
    setStatus("ACTIVE");
    setTicket(null);
    setLines([GREETING]);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label="Open support chat"
        >
          <MessageCircle className="size-5" aria-hidden /> Help
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Collab support chat"
          className="fixed inset-x-3 bottom-3 z-50 flex h-[min(620px,calc(100dvh-24px))] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[380px]"
        >
          <header className="flex items-center justify-between gap-3 bg-ink px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">Collab support</p>
              <p className="text-xs text-white/70">
                {status === "HUMAN_TAKEOVER" ? "You're chatting with our team" : ticket ? `Ticket ${ticket} · our team will join` : "Assistant · usually replies instantly"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {sessionId && (
                <button type="button" onClick={startOver} className="rounded px-2 py-1 text-xs text-white/80 hover:bg-white/10">
                  New chat
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 hover:bg-white/10" aria-label="Close chat">
                <X className="size-5" />
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-tint-1 px-4 py-4" aria-live="polite">
            {lines.map((line) => (
              <div key={line.id} className={cn("flex", line.role === "customer" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    line.role === "customer" && "rounded-br-sm bg-ink text-white",
                    line.role === "assistant" && "rounded-bl-sm border border-line bg-white",
                    line.role === "agent" && "rounded-bl-sm border border-[#b7d3f5] bg-[#eef5fd]",
                    line.role === "system" && "w-full max-w-full rounded-md bg-surface text-center text-xs text-muted-2",
                  )}
                >
                  {line.role === "agent" && (
                    <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#1c5cab]">
                      <Headset className="size-3" aria-hidden /> {line.author ?? "Collab support"}
                    </span>
                  )}
                  {line.pending && !line.text ? <Loader2 className="size-4 animate-spin text-muted-2" aria-label="Assistant is typing" /> : <Linkified text={line.text} />}
                </div>
              </div>
            ))}
            {activity && <p className="text-center text-xs text-muted-2">{activity}</p>}
          </div>

          <form onSubmit={(event) => void send(event)} className="flex items-end gap-2 border-t border-line p-3">
            <label htmlFor="support-chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="support-chat-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask about an order, delivery, returns…"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-[7px] border border-line-2 px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
            <button type="submit" disabled={busy || !input.trim()} className="flex size-10 items-center justify-center rounded-[7px] bg-ink text-white disabled:opacity-40" aria-label="Send message">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            </button>
          </form>
          <p className="px-3 pb-2 text-center text-[10px] text-muted">Never share card numbers, OTPs or UPI PINs in chat. Chats are stored to help our support team.</p>
        </section>
      )}
    </>
  );
}

export function OpenChatButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={openSupportChat} className={className}>
      {children}
    </button>
  );
}
