import { Flag, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/admin/dashboard/alerts-panel";
import { Badge, Card, EmptyState, LinkTabs, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { humanize, relativeTime, type Tone } from "@/lib/admin/format";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { KnowledgeIndexCard } from "@/components/admin/support/knowledge-index-card";
import { hasPermission } from "@/lib/auth/rbac";
import { listInbox } from "@/server/ai/chat.service";
import { knowledgeIndexStatus } from "@/server/ai/rag";

export const metadata: Metadata = { title: "Support inbox" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, Tone> = { ACTIVE: "info", ESCALATED: "warning", HUMAN_TAKEOVER: "success", CLOSED: "neutral" };
const PRIORITY_TONE: Record<string, Tone> = { LOW: "neutral", NORMAL: "info", HIGH: "warning", URGENT: "danger" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Assistant", ESCALATED: "Needs agent", HUMAN_TAKEOVER: "Agent handling", CLOSED: "Closed" };

const VIEWS = [
  { key: "open", label: "Needs attention" },
  { key: "takeover", label: "Taken over" },
  { key: "all", label: "All conversations" },
] as const;

export default async function SupportInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAdminPage("support:inbox", "/admin/support");
  const canManageAi = hasPermission(user.role, "ai:manage");
  const params = await searchParams;
  const view = VIEWS.find((entry) => entry.key === params.view)?.key ?? "open";
  const [sessions, indexStatus] = await Promise.all([listInbox(view), canManageAi ? knowledgeIndexStatus() : Promise.resolve(null)]);

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader title="Support inbox" description="Conversations the AI assistant escalated, plus every chat for review. Take a conversation over to reply to the customer in their chat window." />
      {indexStatus && <KnowledgeIndexCard initial={indexStatus} />}
      <div className="mb-4">
        <LinkTabs items={VIEWS.map((entry) => ({ key: entry.key, label: entry.label, href: entry.key === "open" ? "/admin/support" : `/admin/support?view=${entry.key}` }))} active={view} />
      </div>
      <Card bodyClassName="p-0">
        {sessions.length === 0 ? (
          <EmptyState icon={<Inbox className="size-8" />} title={view === "open" ? "Nothing waiting" : "No conversations yet"}>
            Escalations from the assistant appear here and raise a dashboard alert.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Ticket</Th>
                <Th>Last message</Th>
                <Th align="right">Messages</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-tint-1">
                  <Td>
                    <Link href={`/admin/support/${session.id}`} className="font-medium hover:underline">
                      {session.customer}
                    </Link>
                    {session.flagged && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-danger" title="Flagged by the prompt-injection guard">
                        <Flag className="size-3" aria-hidden /> flagged
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[session.status] ?? "neutral"}>{STATUS_LABEL[session.status] ?? humanize(session.status)}</Badge>
                    {session.takenOverBy && <span className="mt-1 block text-xs text-muted-2">{session.takenOverBy}</span>}
                  </Td>
                  <Td>
                    {session.ticket ? (
                      <>
                        <span className="block font-mono text-xs font-medium">{session.ticket.ticketNumber}</span>
                        <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-2">{session.ticket.subject}</span>
                        <span className="mt-1 inline-block">
                          <Badge tone={PRIORITY_TONE[session.ticket.priority] ?? "neutral"}>{humanize(session.ticket.priority)}</Badge>
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </Td>
                  <Td className="max-w-[320px] text-xs text-muted-2">
                    {session.lastMessage ? (
                      <span className="line-clamp-2">
                        <span className="font-medium text-ink">{session.lastMessage.role === "USER" ? "Customer: " : session.lastMessage.role === "HUMAN_AGENT" ? "Agent: " : "Assistant: "}</span>
                        {session.lastMessage.text}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {session.customerMessages}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-2">{relativeTime(session.lastMessageAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
