"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, inputClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatDateTime, humanize, type Tone } from "@/lib/admin/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";

interface ReturnRow {
  id: string;
  rmaNumber: string;
  type: string;
  status: string;
  quantity: number;
  reason: string;
  description: string | null;
  resolutionNote: string | null;
  item: string;
  createdAt: string;
}

const STATUS_TONE: Record<string, Tone> = { REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", RECEIVED: "info", REFUNDED: "success", CLOSED: "neutral" };
const TYPE_LABEL: Record<string, string> = { RETURN: "Return", REPLACEMENT: "Replacement", WARRANTY_REPAIR: "Warranty" };

/** Customer return / warranty requests with approve / reject actions (orders:manage). */
export function ReturnRequests({ requests, canManage }: { requests: ReturnRow[]; canManage: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    setPending(`${id}:${decision}`);
    setError(null);
    try {
      await apiFetch(`/api/admin/returns/${id}`, { method: "POST", body: { decision, note: notes[id]?.trim() ?? "" } });
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The decision could not be saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {requests.map((request) => (
        <div key={request.id} className="rounded-md border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              <span className="font-mono text-xs">{request.rmaNumber}</span> · {TYPE_LABEL[request.type] ?? request.type} × {request.quantity}
            </p>
            <Badge tone={STATUS_TONE[request.status] ?? "neutral"}>{humanize(request.status)}</Badge>
          </div>
          <p className="mt-1 text-muted-2">{request.item}</p>
          <p className="mt-1">
            <span className="font-medium">{request.reason}</span>
            {request.description && <span className="block whitespace-pre-wrap text-muted-2">{request.description}</span>}
          </p>
          <p className="mt-1 text-xs text-muted">{formatDateTime(request.createdAt)}</p>
          {request.resolutionNote && <p className="mt-2 text-xs">Note to customer: {request.resolutionNote}</p>}
          {canManage && request.status === "REQUESTED" && (
            <div className="mt-3 space-y-2">
              <input
                value={notes[request.id] ?? ""}
                onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                maxLength={500}
                placeholder="Note to the customer (required to reject)"
                aria-label={`Note for ${request.rmaNumber}`}
                className={inputClass}
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => void decide(request.id, "APPROVED")} loading={pending === `${request.id}:APPROVED`}>
                  Approve
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void decide(request.id, "REJECTED")} loading={pending === `${request.id}:REJECTED`}>
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-2">Approving does not move money or stock. When the item is back, issue the refund (with restock) or ship the replacement.</p>
    </div>
  );
}
