"use client";

import { ChevronRight, Download, ScrollText } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Badge, Card, EmptyState, Table, Td, Th } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatDateTime, humanize, type Tone } from "@/lib/admin/format";
import { apiFetch, ApiClientError, downloadFile } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AuditLogRow } from "@/server/admin/audit-log.service";

const ACTION_TONE: Record<string, Tone> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "danger",
  PRICE_CHANGE: "warning",
  STOCK_ADJUSTMENT: "info",
  ORDER_STATUS_CHANGE: "info",
  REFUND: "warning",
  ROLE_CHANGE: "danger",
  COUPON_CHANGE: "info",
  CHAT_TAKEOVER: "neutral",
  BULK_IMPORT: "neutral",
};

function entityHref(row: AuditLogRow): string | null {
  if (row.entityType === "Product") return `/admin/products/${row.entityId}`;
  if (row.entityType === "InventoryItem") return `/admin/inventory/movements?variantId=${row.entityId}`;
  return null;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function Changes({ row }: { row: AuditLogRow }) {
  const diff = row.diff && typeof row.diff === "object" && !Array.isArray(row.diff) ? (row.diff as Record<string, { from: unknown; to: unknown }>) : null;
  if (diff && Object.keys(diff).length > 0) {
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-2">
            <th className="py-1 pr-4 font-medium">Field</th>
            <th className="py-1 pr-4 font-medium">Before</th>
            <th className="py-1 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(diff).map(([field, change]) => (
            <tr key={field} className="align-top">
              <td className="py-1 pr-4 font-mono">{field}</td>
              <td className="max-w-[360px] break-words py-1 pr-4 text-danger line-through decoration-danger/40">{show(change.from)}</td>
              <td className="max-w-[360px] break-words py-1 text-success">{show(change.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div className="grid gap-3 text-xs md:grid-cols-2">
      {(["before", "after"] as const).map((key) => (
        <div key={key}>
          <p className="mb-1 font-medium capitalize text-muted-2">{key}</p>
          <pre className="max-h-64 overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-relaxed">{row[key] === null ? "—" : JSON.stringify(row[key], null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

export function AuditLogViewer({ initial, apiQuery }: { initial: { rows: AuditLogRow[]; nextCursor: string | null }; apiQuery: string }) {
  const [rows, setRows] = useState(initial.rows);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams(apiQuery);
      search.set("cursor", cursor);
      const page = await apiFetch<{ rows: AuditLogRow[]; nextCursor: string | null }>(`/api/admin/audit-log?${search}`);
      setRows((current) => [...current, ...page.rows.filter((row) => !current.some((existing) => existing.id === row.id))]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not load more entries.");
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      await downloadFile(`/api/admin/audit-log/export${apiQuery ? `?${apiQuery}` : ""}`, "audit-log.csv");
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card
      bodyClassName="p-0"
      title={`${rows.length}${cursor ? "+" : ""} entries`}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => void exportCsv()} loading={exporting}>
          {!exporting && <Download className="size-4" aria-hidden />} Export CSV
        </Button>
      }
    >
      {error && (
        <p role="alert" className="border-b border-line bg-[#fdecea] px-5 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-8" />} title="No audit entries match these filters" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-8">
                <span className="sr-only">Expand</span>
              </Th>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Reason</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = expanded.has(row.id);
              const href = entityHref(row);
              return (
                <Fragment key={row.id}>
                  <tr className={cn("cursor-pointer hover:bg-tint-1", open && "bg-tint-1")} onClick={() => toggle(row.id)}>
                    <Td className="pr-0">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? "Hide changes" : "Show changes"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(row.id);
                        }}
                        className="rounded p-0.5 text-muted-2 hover:text-ink"
                      >
                        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
                      </button>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted-2">{formatDateTime(row.createdAt)}</Td>
                    <Td>
                      <span className="block text-sm">{row.actor.name ?? row.actor.email}</span>
                      <span className="block text-xs text-muted-2">{humanize(row.actorRole)}</span>
                    </Td>
                    <Td>
                      <Badge tone={ACTION_TONE[row.action] ?? "neutral"}>{humanize(row.action)}</Badge>
                    </Td>
                    <Td>
                      <span className="block text-sm">{row.entityType}</span>
                      {href ? (
                        <Link href={href} onClick={(event) => event.stopPropagation()} className="block font-mono text-xs text-muted-2 hover:text-ink hover:underline">
                          {row.entityId}
                        </Link>
                      ) : (
                        <span className="block font-mono text-xs text-muted-2">{row.entityId}</span>
                      )}
                    </Td>
                    <Td className="max-w-[280px] truncate text-xs text-muted-2">
                      <span title={row.reason ?? undefined}>{row.reason ?? "—"}</span>
                    </Td>
                  </tr>
                  {open && (
                    <tr className="bg-tint-1">
                      <td colSpan={6} className="border-b border-line px-6 pb-4 pt-1">
                        <Changes row={row} />
                        <p className="mt-3 text-[11px] text-muted">
                          IP {row.ip ?? "—"} · request {row.requestId ?? "—"}
                          {row.userAgent && <> · {row.userAgent.slice(0, 120)}</>}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}
      {cursor && (
        <div className="flex justify-center border-t border-line p-4">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()} loading={loading}>
            Load older entries
          </Button>
        </div>
      )}
    </Card>
  );
}
