"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen, Radio, RefreshCw, SlidersHorizontal, WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, EmptyState, Table, Td, Th } from "@/components/admin/ui";
import { formatInteger, relativeTime } from "@/lib/admin/format";
import { apiFetch } from "@/lib/api-client";
import type { InventoryEvent } from "@/lib/realtime/inventory-events";
import { cn, formatMoney } from "@/lib/utils";
import type { InventoryPage, InventoryRow } from "@/server/admin/inventory.service";
import { AdjustStockDialog } from "./adjust-dialog";

export interface InventoryQuery {
  q: string;
  filter: "all" | "low" | "out" | "reserved";
  sort: "urgency" | "sku" | "recent";
  page: number;
}

type LiveState = "connecting" | "live" | "reconnecting" | "polling";

const STATUS_BADGE = {
  in_stock: { tone: "success", label: "In stock" },
  low: { tone: "warning", label: "Low stock" },
  out: { tone: "danger", label: "Out of stock" },
} as const;

const POLL_MS = 15_000;
const FLASH_MS = 2_400;

function statusFor(available: number, threshold: number): InventoryRow["status"] {
  if (available <= 0) return "out";
  return available <= threshold ? "low" : "in_stock";
}

function queryString(query: InventoryQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.sort !== "urgency") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

/**
 * Live stock table. Server-rendered first page, then:
 *  - an EventSource on /api/admin/inventory/stream patches rows in place as stock moves
 *    (checkouts, payments, expiry releases, other admins' adjustments);
 *  - a debounced refetch picks up summary totals and rows that changed filter bucket;
 *  - if the stream is unavailable (Redis down, proxy without SSE) it degrades to polling.
 */
export function InventoryCenter({ initial, query }: { initial: InventoryPage; query: InventoryQuery }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["admin-inventory", queryString(query)] as const, [query]);
  const [live, setLive] = useState<LiveState>("connecting");
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [adjusting, setAdjusting] = useState<string | null>(null);

  const { data, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiFetch<InventoryPage>(`/api/admin/inventory?${queryString(query)}`, { signal }),
    initialData: initial,
    staleTime: 5_000,
    refetchInterval: live === "polling" ? POLL_MS : false,
    refetchIntervalInBackground: false,
  });

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void queryClient.invalidateQueries({ queryKey }), 1_500);
  }, [queryClient, queryKey]);

  const applyEvent = useCallback(
    (event: InventoryEvent) => {
      let matched = false;
      queryClient.setQueryData<InventoryPage>(queryKey, (current) => {
        if (!current) return current;
        const rows = current.rows.map((row) => {
          if (row.variantId !== event.variantId) return row;
          // Events can arrive out of order across processes; never move a row backwards.
          if (event.version !== undefined && event.version < row.version) return row;
          matched = true;
          return {
            ...row,
            onHand: event.onHand,
            reserved: event.reserved,
            available: event.available,
            threshold: event.threshold,
            version: event.version ?? row.version,
            status: statusFor(event.available, event.threshold),
            updatedAt: event.at,
          };
        });
        return matched ? { ...current, rows } : current;
      });
      if (matched) setFlash((current) => ({ ...current, [event.variantId]: Date.now() }));
      scheduleRefetch();
    },
    [queryClient, queryKey, scheduleRefetch],
  );

  // EventSource lifecycle with bounded reconnects; falls back to polling.
  useEffect(() => {
    let source: EventSource | null = null;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource("/api/admin/inventory/stream");
      source.addEventListener("ready", () => {
        failures = 0;
        setLive("live");
      });
      source.addEventListener("stock", (message) => {
        try {
          applyEvent(JSON.parse((message as MessageEvent<string>).data) as InventoryEvent);
        } catch {
          // ignore malformed frames
        }
      });
      source.addEventListener("unavailable", () => {
        source?.close();
        setLive("polling");
        // Try the stream again later; polling covers the gap.
        retryTimer = setTimeout(connect, 60_000);
      });
      source.addEventListener("reconnect", () => setLive("reconnecting"));
      source.onerror = () => {
        if (!source || source.readyState !== EventSource.CLOSED) {
          setLive("reconnecting");
          return;
        }
        // The server refused the stream (e.g. access token expired): refresh via a normal API
        // call (apiFetch rotates the session) and reconnect with backoff.
        failures += 1;
        if (failures >= 5) {
          setLive("polling");
          retryTimer = setTimeout(() => {
            failures = 0;
            connect();
          }, 60_000);
          return;
        }
        setLive("reconnecting");
        void apiFetch("/api/admin/inventory?page=1").catch(() => undefined);
        retryTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** failures));
      };
    };

    if (typeof EventSource === "undefined") setLive("polling");
    else connect();
    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [applyEvent]);

  // Clear row highlights after they fade.
  useEffect(() => {
    const ids = Object.keys(flash);
    if (ids.length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - FLASH_MS;
      setFlash((current) => Object.fromEntries(Object.entries(current).filter(([, at]) => at > cutoff)));
    }, FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  const { summary, rows } = data;
  const adjustingRow = rows.find((row) => row.variantId === adjusting) ?? null;

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryTile label="SKUs tracked" value={formatInteger(summary.skus)} />
        <SummaryTile label="Low stock" value={formatInteger(summary.lowStock)} tone={summary.lowStock > 0 ? "warning" : undefined} href="/admin/inventory?filter=low" />
        <SummaryTile label="Out of stock" value={formatInteger(summary.outOfStock)} tone={summary.outOfStock > 0 ? "danger" : undefined} href="/admin/inventory?filter=out" />
        <SummaryTile label="Units on hand" value={formatInteger(summary.unitsOnHand)} />
        <SummaryTile label="Units reserved" value={formatInteger(summary.unitsReserved)} href="/admin/inventory?filter=reserved" />
        <SummaryTile label="Stock value (cost)" value={formatMoney(summary.stockValueMinor)} />
      </div>

      <Card
        bodyClassName="p-0"
        title={
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Stock levels</h2>
            <LiveIndicator state={live} />
          </div>
        }
        actions={
          <div className="flex items-center gap-3 text-xs text-muted-2">
            <span aria-live="polite">Updated {relativeTime(new Date(dataUpdatedAt))}</span>
            <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-1 rounded-md border border-line-2 px-2 py-1 font-medium hover:border-ink" aria-label="Refresh stock levels">
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden /> Refresh
            </button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState icon={<PackageOpen className="size-8" />} title="No SKUs match these filters" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Status</Th>
                <Th align="right">On hand</Th>
                <Th align="right">Reserved</Th>
                <Th align="right">Available</Th>
                <Th align="right">Alert at</Th>
                <Th>Location</Th>
                <Th>Last change</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = STATUS_BADGE[row.status];
                return (
                  <tr key={row.variantId} className={cn("transition-colors duration-700", flash[row.variantId] ? "bg-[#fff8e1]" : "hover:bg-tint-1")} data-testid={`inventory-row-${row.sku}`}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className="relative size-9 shrink-0 overflow-hidden rounded bg-surface">
                          {row.imageUrl && <Image src={row.imageUrl} alt="" fill sizes="36px" className="object-contain" unoptimized />}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-mono text-xs font-medium">{row.sku}</span>
                          <Link href={`/admin/products/${row.productId}`} className="block max-w-[260px] truncate text-xs text-muted-2 hover:text-ink hover:underline">
                            {row.productName} · {row.title}
                          </Link>
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {!row.isActive && <Badge>Inactive</Badge>}
                      </div>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatInteger(row.onHand)}
                    </Td>
                    <Td align="right" className="tabular-nums text-muted-2">
                      {formatInteger(row.reserved)}
                    </Td>
                    <Td align="right" className={cn("font-semibold tabular-nums", row.status === "out" && "text-danger", row.status === "low" && "text-[#8a5a00]")}>
                      {formatInteger(row.available)}
                    </Td>
                    <Td align="right" className="tabular-nums text-muted-2">
                      ≤ {formatInteger(row.threshold)}
                    </Td>
                    <Td className="text-xs text-muted-2">{row.warehouse}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted-2">{relativeTime(row.updatedAt)}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/admin/inventory/movements?variantId=${row.variantId}&sku=${encodeURIComponent(row.sku)}`} className="rounded-md px-2 py-1 text-xs font-medium text-muted-2 hover:text-ink">
                          History
                        </Link>
                        <button
                          type="button"
                          onClick={() => setAdjusting(row.variantId)}
                          className="inline-flex items-center gap-1 rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium hover:border-ink"
                          aria-label={`Adjust stock for ${row.sku}`}
                        >
                          <SlidersHorizontal className="size-3.5" aria-hidden /> Adjust
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <AdjustStockDialog
        row={adjustingRow}
        onClose={() => setAdjusting(null)}
        onSaved={(updated) => {
          queryClient.setQueryData<InventoryPage>(queryKey, (current) =>
            current
              ? {
                  ...current,
                  rows: current.rows.map((row) =>
                    row.variantId === updated.variantId
                      ? { ...row, ...updated, status: statusFor(updated.available, updated.threshold), updatedAt: new Date().toISOString() }
                      : row,
                  ),
                }
              : current,
          );
          setFlash((current) => ({ ...current, [updated.variantId]: Date.now() }));
          scheduleRefetch();
        }}
        onConflict={() => void queryClient.invalidateQueries({ queryKey })}
      />
    </>
  );
}

function SummaryTile({ label, value, tone, href }: { label: string; value: string; tone?: "warning" | "danger" | undefined; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-2">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "warning" && "text-[#8a5a00]", tone === "danger" && "text-danger")}>{value}</p>
    </>
  );
  const className = "rounded-[var(--radius-card)] border border-line bg-white px-4 py-3";
  return href ? (
    <Link href={href} className={cn(className, "transition-colors hover:border-ink")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function LiveIndicator({ state }: { state: LiveState }) {
  if (state === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success" role="status">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        Live
      </span>
    );
  }
  if (state === "polling") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-2" role="status" title="Live feed unavailable; refreshing every 15 seconds">
        <WifiOff className="size-3.5" aria-hidden /> Polling every 15 s
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-2" role="status">
      <Radio className="size-3.5 animate-pulse" aria-hidden /> {state === "connecting" ? "Connecting…" : "Reconnecting…"}
    </span>
  );
}
