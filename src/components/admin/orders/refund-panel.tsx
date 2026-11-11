"use client";

import { RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, inputClass, selectClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatDateTime, humanize, parseRupees } from "@/lib/admin/format";
import { apiFetch, ApiClientError, newIdempotencyKey } from "@/lib/api-client";
import { cn, formatMoney } from "@/lib/utils";
import { refundRequestSchema } from "@/schemas/admin";

interface RefundItem {
  id: string;
  label: string;
  sku: string;
  quantity: number;
  refundedQuantity: number;
  lineTotalMinor: number;
}

interface RefundEntry {
  id: string;
  amountMinor: number;
  status: string;
  reason: string;
  createdAt: string;
  processedAt: string | null;
  initiatedBy: string | null;
}

const STATUS_TONE = { PENDING: "warning", SUCCEEDED: "success", FAILED: "danger" } as const;

/** Mirrors the server's floor-telescoping split so the preview matches what will be refunded. */
function lineShare(lineTotalMinor: number, quantity: number, alreadyRefunded: number, refundQuantity: number): number {
  const upTo = (units: number) => Math.floor((lineTotalMinor * units) / quantity);
  return upTo(alreadyRefunded + refundQuantity) - upTo(alreadyRefunded);
}

export function RefundPanel({
  orderNumber,
  currency,
  canRefund,
  refundableMinor,
  dispatched,
  items,
  refunds,
}: {
  orderNumber: string;
  currency: string;
  canRefund: boolean;
  refundableMinor: number;
  dispatched: boolean;
  items: RefundItem[];
  refunds: RefundEntry[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"items" | "amount">("items");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState("");
  const [restock, setRestock] = useState(false);
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const money = (minor: number) => formatMoney(minor, currency);

  const itemsTotal = useMemo(
    () => Math.min(refundableMinor, items.reduce((sum, item) => sum + lineShare(item.lineTotalMinor, item.quantity, item.refundedQuantity, quantities[item.id] ?? 0), 0)),
    [items, quantities, refundableMinor],
  );
  const amountMinor = parseRupees(amount);
  const previewMinor = mode === "items" ? itemsTotal : amountMinor !== null && !Number.isNaN(amountMinor) ? amountMinor : 0;

  const start = () => {
    setOpen(true);
    setMode("items");
    setQuantities({});
    setAmount("");
    setRestock(false);
    setReason("");
    setError(null);
    setIdempotencyKey(newIdempotencyKey());
  };

  async function submit() {
    setError(null);
    const body = {
      mode,
      items: mode === "items" ? Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity })) : [],
      ...(mode === "amount" && amountMinor !== null && !Number.isNaN(amountMinor) ? { amountMinor } : {}),
      restock: mode === "items" && dispatched && restock,
      reason,
    };
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the refund.");
      return;
    }
    if (previewMinor > refundableMinor) {
      setError(`At most ${money(refundableMinor)} can still be refunded.`);
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/orders/${orderNumber}/refunds`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The refund could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function retry(id: string) {
    setRetrying(id);
    try {
      await apiFetch(`/api/admin/refunds/${id}/retry`, { method: "POST" });
      router.refresh();
    } catch (failure) {
      window.alert(failure instanceof ApiClientError ? failure.message : "Could not re-queue the refund.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="text-muted-2">Refundable:</span> <span className="font-semibold tabular-nums">{money(refundableMinor)}</span>
        </p>
        {canRefund && refundableMinor > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={start}>
            <Undo2 className="size-4" aria-hidden /> Issue refund
          </Button>
        )}
      </div>

      {refunds.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {refunds.map((refund) => (
            <li key={refund.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium tabular-nums">{money(refund.amountMinor)}</p>
                <p className="text-xs text-muted-2">{refund.reason}</p>
                <p className="text-[11px] text-muted">
                  {formatDateTime(refund.createdAt)} · {refund.initiatedBy ?? "System"}
                  {refund.processedAt && ` · processed ${formatDateTime(refund.processedAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[refund.status as keyof typeof STATUS_TONE] ?? "neutral"}>{humanize(refund.status)}</Badge>
                {canRefund && refund.status === "PENDING" && (
                  <button
                    type="button"
                    onClick={() => void retry(refund.id)}
                    disabled={retrying === refund.id}
                    className="inline-flex items-center gap-1 rounded-md border border-line-2 px-2 py-1 text-xs font-medium hover:border-ink disabled:opacity-50"
                    title="Re-queue this refund with the payment provider"
                  >
                    <RotateCcw className="size-3" aria-hidden /> Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Issue refund" description={`Order ${orderNumber} · up to ${money(refundableMinor)} refundable`} className="max-w-xl">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-[7px] bg-surface p-1" role="radiogroup" aria-label="Refund type">
            {(
              [
                ["items", "Refund items"],
                ["amount", "Custom amount"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn("rounded-[5px] px-2 py-1.5 text-sm font-medium", mode === value ? "bg-white shadow-sm" : "text-muted-2 hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "items" ? (
            <div className="space-y-3">
              <ul className="divide-y divide-line rounded-md border border-line">
                {items.map((item) => {
                  const remaining = item.quantity - item.refundedQuantity;
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{item.label}</p>
                        <p className="text-xs text-muted-2">
                          <span className="font-mono">{item.sku}</span> · {remaining} of {item.quantity} refundable
                        </p>
                      </div>
                      <select
                        aria-label={`Units of ${item.sku} to refund`}
                        value={quantities[item.id] ?? 0}
                        onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Number(event.target.value) }))}
                        disabled={remaining === 0}
                        className={`${selectClass} h-9 w-20`}
                      >
                        {Array.from({ length: remaining + 1 }, (_, units) => (
                          <option key={units} value={units}>
                            {units}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
              {dispatched && (
                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox checked={restock} onCheckedChange={(value) => setRestock(value === true)} />
                  <span>
                    Restock the returned units
                    <span className="block text-xs text-muted-2">Only when the items are back in the warehouse and sellable.</span>
                  </span>
                </label>
              )}
            </div>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Amount (₹)</span>
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" className={inputClass} />
              <span className="mt-1 block text-xs text-muted-2">Goodwill credits, price adjustments, shipping refunds.</span>
            </label>
          )}

          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium">Reason</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Shown on the refund record and to the customer" className={inputClass} />
          </label>

          <p className="mt-4 text-sm" aria-live="polite">
            Refund to the original payment method: <span className="font-semibold tabular-nums">{money(previewMinor)}</span>
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} loading={saving} disabled={previewMinor <= 0}>
              Refund {money(previewMinor)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
