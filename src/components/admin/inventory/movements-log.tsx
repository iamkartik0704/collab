"use client";

import { Download, ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, EmptyState, Table, Td, Th } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatInteger, humanize, type Tone } from "@/lib/admin/format";
import { apiFetch, ApiClientError, downloadFile } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ADJUSTMENT_REASON_LABELS } from "@/schemas/admin";
import type { MovementRow } from "@/server/admin/inventory.service";

const TYPE_TONE: Record<string, Tone> = {
  RESTOCK: "success",
  CUSTOMER_RETURN: "success",
  ORDER_CANCELLATION: "success",
  RESERVATION: "info",
  RESERVATION_RELEASE: "neutral",
  SALE: "info",
  MANUAL_ADJUSTMENT: "warning",
  DAMAGE: "danger",
  CSV_IMPORT: "neutral",
};

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted">0</span>;
  return <span className={cn("font-medium tabular-nums", value > 0 ? "text-success" : "text-danger")}>{`${value > 0 ? "+" : ""}${formatInteger(value)}`}</span>;
}

/** Keyset-paginated ledger with "load more" and a filtered CSV export (newest 1,000 rows). */
export function MovementsLog({ initial, apiQuery }: { initial: { rows: MovementRow[]; nextCursor: string | null }; apiQuery: string }) {
  const [rows, setRows] = useState(initial.rows);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams(apiQuery);
      search.set("cursor", cursor);
      const page = await apiFetch<{ rows: MovementRow[]; nextCursor: string | null }>(`/api/admin/inventory/movements?${search}`);
      setRows((current) => [...current, ...page.rows.filter((row) => !current.some((existing) => existing.id === row.id))]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not load more movements.");
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const search = new URLSearchParams(apiQuery);
      search.set("format", "csv");
      await downloadFile(`/api/admin/inventory/movements?${search}`, "stock-movements.csv");
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card
      bodyClassName="p-0"
      title={`${formatInteger(rows.length)}${cursor ? "+" : ""} movements`}
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
        <EmptyState icon={<ScrollText className="size-8" />} title="No stock movements match these filters" />
      ) : (
        <Table className="[&_table]:min-w-[980px]">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>SKU</Th>
              <Th>Type</Th>
              <Th align="right">On hand Δ</Th>
              <Th align="right">Reserved Δ</Th>
              <Th align="right">On hand</Th>
              <Th align="right">Reserved</Th>
              <Th align="right">Available</Th>
              <Th>Reference</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-tint-1">
                <Td className="whitespace-nowrap text-xs text-muted-2">{formatDateTime(row.createdAt)}</Td>
                <Td>
                  <span className="block font-mono text-xs font-medium">{row.sku}</span>
                  <span className="block max-w-[200px] truncate text-xs text-muted-2">{row.productName}</span>
                </Td>
                <Td>
                  <Badge tone={TYPE_TONE[row.type] ?? "neutral"}>{humanize(row.type)}</Badge>
                  {row.reason && (
                    <span className="mt-1 block text-xs text-muted-2">
                      {ADJUSTMENT_REASON_LABELS[row.reason as keyof typeof ADJUSTMENT_REASON_LABELS]?.label ?? humanize(row.reason)}
                    </span>
                  )}
                </Td>
                <Td align="right">
                  <Delta value={row.onHandDelta} />
                </Td>
                <Td align="right">
                  <Delta value={row.reservedDelta} />
                </Td>
                <Td align="right" className="tabular-nums">
                  {formatInteger(row.onHandAfter)}
                </Td>
                <Td align="right" className="tabular-nums text-muted-2">
                  {formatInteger(row.reservedAfter)}
                </Td>
                <Td align="right" className="font-semibold tabular-nums">
                  {formatInteger(row.availableAfter)}
                </Td>
                <Td className="text-xs">
                  {row.orderNumber && (
                    <Link href={`/admin/orders/${row.orderNumber}`} className="block font-mono font-medium hover:underline">
                      {row.orderNumber}
                    </Link>
                  )}
                  {row.note && <span className="block max-w-[220px] truncate text-muted-2" title={row.note}>{row.note}</span>}
                </Td>
                <Td className="text-xs text-muted-2">{row.actor ?? "System"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {cursor && (
        <div className="flex justify-center border-t border-line p-4">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()} loading={loading}>
            Load older movements
          </Button>
        </div>
      )}
    </Card>
  );
}
