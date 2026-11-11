"use client";

import { AlertCircle, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { inputClass, selectClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatInteger } from "@/lib/admin/format";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ADJUSTMENT_REASON_LABELS, ADJUSTMENT_REASON_VALUES, stockAdjustmentSchema } from "@/schemas/admin";
import type { InventoryRow } from "@/server/admin/inventory.service";

type Reason = (typeof ADJUSTMENT_REASON_VALUES)[number];
type Mode = "add" | "remove" | "set";

export interface StockSnapshot {
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  version: number;
}

const DEFAULT_REASON: Record<Mode, Reason> = { add: "PURCHASE_ORDER_RECEIVED", remove: "DAMAGED", set: "CYCLE_COUNT_CORRECTION" };

function reasonsFor(mode: Mode): Reason[] {
  return ADJUSTMENT_REASON_VALUES.filter((reason) => {
    const { direction } = ADJUSTMENT_REASON_LABELS[reason];
    if (mode === "set") return direction === "any";
    return direction === "any" || direction === (mode === "add" ? "in" : "out");
  });
}

/**
 * Manual stock adjustment. Sends the row version it was opened with, so an adjustment made on
 * stale numbers (another admin, a checkout) is rejected with 409 instead of silently applied.
 */
export function AdjustStockDialog({
  row,
  onClose,
  onSaved,
  onConflict,
}: {
  row: InventoryRow | null;
  onClose: () => void;
  onSaved: (snapshot: StockSnapshot) => void;
  onConflict: () => void;
}) {
  const [mode, setMode] = useState<Mode>("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<Reason>(DEFAULT_REASON.add);
  const [note, setNote] = useState("");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  // Version pinned when the dialog opened; moves only when the admin accepts newer numbers.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  const open = row !== null;
  const variantId = row?.variantId;
  useEffect(() => {
    if (!variantId) return;
    setMode("add");
    setQuantity("");
    setReason(DEFAULT_REASON.add);
    setNote("");
    setError(null);
    setConflict(false);
    setSaving(false);
    setBaseVersion(row?.version ?? null);
  }, [variantId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (row) setThreshold(String(row.threshold));
  }, [row?.variantId, row?.threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  const version = baseVersion ?? row?.version ?? 0;
  const changedUnderneath = row !== null && baseVersion !== null && row.version !== baseVersion;

  const amount = Number(quantity);
  const validAmount = quantity.trim() !== "" && Number.isInteger(amount) && amount >= 0;
  const delta = !row || !validAmount ? 0 : mode === "set" ? amount - row.onHand : mode === "add" ? amount : -amount;
  const nextOnHand = row ? row.onHand + delta : 0;
  const nextAvailable = row ? nextOnHand - row.reserved : 0;
  const reasons = useMemo(() => reasonsFor(mode), [mode]);

  async function submit() {
    if (!row) return;
    setError(null);
    const request = {
      mode: mode === "set" ? ("set" as const) : ("delta" as const),
      quantity: mode === "set" ? amount : delta,
      reason,
      note,
      expectedVersion: version,
    };
    const parsed = stockAdjustmentSchema.safeParse(request);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the adjustment.");
      return;
    }
    if (mode === "set" && delta === 0) {
      setError("The count matches the current on-hand quantity; nothing to change.");
      return;
    }
    if (nextOnHand < row.reserved) {
      setError(`${row.reserved} unit(s) are reserved by pending checkouts; on hand cannot go below that.`);
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch<{ inventory: StockSnapshot }>(`/api/admin/inventory/${row.variantId}/adjust`, { method: "POST", body: request });
      onSaved(response.inventory);
      onClose();
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.status === 409) {
        setConflict(true);
        onConflict();
      }
      setError(failure instanceof ApiClientError ? failure.message : "Could not save the adjustment.");
    } finally {
      setSaving(false);
    }
  }

  async function saveThreshold() {
    if (!row) return;
    const value = Number(threshold);
    if (!Number.isInteger(value) || value < 0) {
      setError("The alert threshold must be a whole number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/inventory/${row.variantId}`, { method: "PATCH", body: { lowStockThreshold: value } });
      onSaved({ variantId: row.variantId, onHand: row.onHand, reserved: row.reserved, available: row.available, threshold: value, version: row.version + 1 });
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not update the threshold.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {row && (
        <DialogContent title={`Adjust ${row.sku}`} description={`${row.productName} · ${row.title}`} className="max-w-xl">
          <div className="mb-5 grid grid-cols-3 gap-3 rounded-[var(--radius-card)] bg-tint-1 p-4 text-center">
            <Stat label="On hand" value={row.onHand} />
            <Stat label="Reserved" value={row.reserved} />
            <Stat label="Available" value={row.available} />
          </div>

          {(conflict || changedUnderneath) && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-[#e9c46a] bg-[#fff8e1] p-3 text-sm text-[#8a5a00]">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p>Stock changed while this dialog was open. The numbers above are now current.</p>
                <button
                  type="button"
                  className="mt-1 font-medium underline underline-offset-2"
                  onClick={() => {
                    setBaseVersion(row.version);
                    setConflict(false);
                    setError(null);
                  }}
                >
                  Use the latest numbers
                </button>
              </div>
            </div>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Adjustment</legend>
            <div className="mb-4 grid grid-cols-3 gap-1 rounded-[7px] bg-surface p-1" role="radiogroup" aria-label="Adjustment type">
              {(
                [
                  ["add", "Add units"],
                  ["remove", "Remove units"],
                  ["set", "Set count"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => {
                    setMode(value);
                    setReason(DEFAULT_REASON[value]);
                    setError(null);
                  }}
                  className={cn("rounded-[5px] px-2 py-1.5 text-sm font-medium", mode === value ? "bg-white shadow-sm" : "text-muted-2 hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{mode === "set" ? "Counted on hand" : "Units"}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className={inputClass}
                autoFocus
                aria-describedby="adjust-preview"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Reason</span>
              <select value={reason} onChange={(event) => setReason(event.target.value as Reason)} className={`${selectClass} w-full`}>
                {reasons.map((value) => (
                  <option key={value} value={value}>
                    {ADJUSTMENT_REASON_LABELS[value].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">
                Note {reason === "SYSTEM_CORRECTION" || reason === "LOST_OR_STOLEN" ? <span className="text-danger">(required)</span> : <span className="font-normal text-muted-2">(optional)</span>}
              </span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="PO number, count sheet, incident ref…" className={inputClass} />
            </label>
          </div>

          <p id="adjust-preview" className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            {validAmount && delta !== 0 ? (
              <>
                <span className="text-muted-2">On hand</span>
                <span className="tabular-nums">{formatInteger(row.onHand)}</span>
                <ArrowRight className="size-3.5 text-muted-2" aria-hidden />
                <span className={cn("font-semibold tabular-nums", nextOnHand < row.reserved && "text-danger")}>{formatInteger(nextOnHand)}</span>
                <span className="ml-2 text-muted-2">Available</span>
                <span className="font-semibold tabular-nums">{formatInteger(Math.max(nextAvailable, 0))}</span>
                <span className={cn("rounded px-1.5 text-xs font-medium tabular-nums", delta > 0 ? "bg-[#e6f4ea] text-success" : "bg-[#fdecea] text-danger")}>
                  {delta > 0 ? "+" : ""}
                  {formatInteger(delta)}
                </span>
              </>
            ) : (
              <span className="text-muted-2">Enter a quantity to preview the change.</span>
            )}
          </p>

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} loading={saving} disabled={!validAmount || delta === 0 || conflict || changedUnderneath}>
              Record adjustment
            </Button>
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-2 text-sm font-medium">Low-stock alert</p>
            <div className="flex items-end gap-2">
              <label className="block flex-1">
                <span className="mb-1.5 block text-xs text-muted-2">Alert when available stock is at or below</span>
                <input type="number" min={0} step={1} value={threshold} onChange={(event) => setThreshold(event.target.value)} className={inputClass} />
              </label>
              <Button type="button" variant="outline" size="sm" onClick={() => void saveThreshold()} disabled={saving || threshold === String(row.threshold)}>
                Save threshold
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-2">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{formatInteger(value)}</p>
    </div>
  );
}
