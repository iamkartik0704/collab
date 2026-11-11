"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api-client";

type Action = { action: "takeover" } | { action: "reply"; text: string } | { action: "release" } | { action: "resolve"; note: string | null };

export function ConversationActions({ sessionId, status, mine, takenByOther }: { sessionId: string; status: string; mine: boolean; takenByOther: string | null }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState<Action["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(body: Action) {
    setPending(body.action);
    setError(null);
    try {
      await apiFetch(`/api/admin/support/${sessionId}`, { method: "POST", body });
      if (body.action === "reply") setReply("");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The action failed.");
    } finally {
      setPending(null);
    }
  }

  if (status === "CLOSED") return <p className="text-sm text-muted-2">This conversation is closed. A new message from the customer starts a new conversation.</p>;

  return (
    <div className="space-y-4">
      {takenByOther && <p className="text-sm text-muted-2">{takenByOther} is handling this conversation.</p>}
      {!mine && !takenByOther && (
        <div>
          <Button type="button" size="sm" block onClick={() => void run({ action: "takeover" })} loading={pending === "takeover"}>
            Take over conversation
          </Button>
          <p className="mt-1.5 text-xs text-muted-2">The assistant stops replying; your messages appear in the customer&apos;s chat window.</p>
        </div>
      )}
      {mine && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reply.trim()) void run({ action: "reply", text: reply.trim() });
          }}
          className="space-y-2"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Reply to the customer</span>
            <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} maxLength={4000} className={`${inputClass} h-auto py-2`} />
          </label>
          <Button type="submit" size="sm" block loading={pending === "reply"} disabled={!reply.trim()}>
            Send reply
          </Button>
          <Button type="button" variant="ghost" size="sm" block onClick={() => void run({ action: "release" })} loading={pending === "release"}>
            Hand back to the assistant
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        block
        onClick={() => {
          const note = window.prompt("Resolution note (optional)");
          if (note !== null) void run({ action: "resolve", note: note.trim() || null });
        }}
        loading={pending === "resolve"}
      >
        Resolve & close
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
