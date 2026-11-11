import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/admin/dashboard/alerts-panel";
import { ConversationActions } from "@/components/admin/support/conversation-actions";
import { Badge, Card, PageHeader } from "@/components/admin/ui";
import { formatDateTime, humanize } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { cn } from "@/lib/utils";
import { getInboxSession } from "@/server/ai/chat.service";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await requireAdminPage("support:inbox", `/admin/support/${sessionId}`);
  const data = await getInboxSession(sessionId);
  if (!data) notFound();
  const { session, transcript } = data;
  const mine = session.status === "HUMAN_TAKEOVER" && session.takenOverById === user.id;

  return (
    <>
      <AutoRefresh seconds={8} />
      <Link href="/admin/support" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Support inbox
      </Link>
      <PageHeader title={session.ticket?.subject ?? `Conversation with ${session.customer?.name ?? "a guest"}`}>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-2">
          <Badge tone={session.status === "ESCALATED" ? "warning" : session.status === "HUMAN_TAKEOVER" ? "success" : "neutral"}>{humanize(session.status)}</Badge>
          {session.ticket && <span className="font-mono text-xs">{session.ticket.ticketNumber}</span>}
          <span>Started {formatDateTime(session.createdAt)}</span>
          {session.takenOverBy && <span>· handled by {session.takenOverBy.name}</span>}
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Transcript" bodyClassName="space-y-3 bg-tint-1">
          {transcript.length === 0 && <p className="text-sm text-muted-2">No messages yet.</p>}
          {transcript.map((message) =>
            message.role === "tool" ? (
              <details key={message.id} className="rounded-md border border-dashed border-line-2 bg-white px-3 py-2 text-xs text-muted-2">
                <summary className="cursor-pointer">Assistant used: {message.text}</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{JSON.stringify(message.tool, null, 2)}</pre>
              </details>
            ) : (
              <div key={message.id} className={cn("flex", message.role === "customer" ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-[80%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm",
                    message.role === "customer" && "border border-line bg-white",
                    message.role === "assistant" && "bg-surface-2",
                    message.role === "agent" && "bg-ink text-white",
                  )}
                >
                  <span className={cn("mb-0.5 block text-[11px] font-semibold", message.role === "agent" ? "text-white/70" : "text-muted-2")}>
                    {message.role === "customer" ? (session.customer?.name ?? "Customer") : message.role === "agent" ? (message.author ?? "Agent") : "Assistant"} · {formatDateTime(message.createdAt)}
                    {message.flagged && <span className="ml-1 text-danger">· flagged</span>}
                  </span>
                  {message.text}
                </div>
              </div>
            ),
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Actions">
            <ConversationActions sessionId={session.id} status={session.status} mine={mine} takenByOther={session.status === "HUMAN_TAKEOVER" && !mine ? (session.takenOverBy?.name ?? "another agent") : null} />
          </Card>
          <Card title="Customer">
            <p className="font-medium">{session.customer?.name ?? "Guest"}</p>
            <p className="text-sm text-muted-2">{session.customer?.email ?? session.ticket?.contactEmail ?? "No email"}</p>
            <p className="text-sm text-muted-2">{session.customer?.phone ?? session.ticket?.contactPhone ?? ""}</p>
            {session.ticket?.order && (
              <Link href={`/admin/orders/${session.ticket.order.orderNumber}`} className="mt-2 inline-block font-mono text-xs font-medium underline">
                {session.ticket.order.orderNumber}
              </Link>
            )}
          </Card>
          {session.ticket && (
            <Card title="Hand-off summary">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge>{humanize(session.ticket.category)}</Badge>
                <Badge tone={session.ticket.priority === "URGENT" ? "danger" : session.ticket.priority === "HIGH" ? "warning" : "info"}>{humanize(session.ticket.priority)}</Badge>
                <Badge tone={session.ticket.status === "RESOLVED" ? "success" : "neutral"}>{humanize(session.ticket.status)}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm">{session.ticket.summary}</p>
            </Card>
          )}
          {session.flaggedReason && (
            <Card title="Flags">
              <p className="text-sm text-danger">{session.flaggedReason}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
