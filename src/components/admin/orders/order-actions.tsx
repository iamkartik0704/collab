"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { apiFetch, ApiClientError, newIdempotencyKey } from "@/lib/api-client";
import { formatMoney } from "@/lib/utils";
import { itemSerialsSchema, PRE_DISPATCH_STATUSES, trackingSchema, type OrderStatusValue } from "@/schemas/admin";

interface SerialItem {
  id: string;
  label: string;
  sku: string;
  quantity: number;
  serialNumbers: string[];
}

const ACTION_LABEL: Partial<Record<OrderStatusValue, string>> = {
  CONFIRMED: "Confirm order",
  PACKED: "Mark packed",
  SHIPPED: "Mark shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Mark delivered",
  RETURNED: "Mark returned",
  CANCELLED: "Cancel order",
};

/** Fulfilment state-machine buttons. The server re-validates every transition under the order lock. */
export function OrderActions({
  orderNumber,
  status,
  allowed,
  canRefund,
  refundableMinor,
  currency,
  hasTracking,
  items,
}: {
  orderNumber: string;
  status: OrderStatusValue;
  allowed: OrderStatusValue[];
  canRefund: boolean;
  refundableMinor: number;
  currency: string;
  hasTracking: boolean;
  items: SerialItem[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<OrderStatusValue | null>(null);
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState({ carrierName: "", trackingNumber: "", trackingUrl: "" });
  const [restock, setRestock] = useState(true);
  const [refundRemaining, setRefundRemaining] = useState(false);
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (allowed.length === 0) return null;

  const cancellingPaid = target === "CANCELLED" && PRE_DISPATCH_STATUSES.includes(status);
  const blockedByPermission = cancellingPaid && !canRefund && refundableMinor > 0;
  const needsTracking = target === "SHIPPED" && !hasTracking;
  const capturesSerials = target === "PACKED" || target === "SHIPPED";

  const open = (to: OrderStatusValue) => {
    setTarget(to);
    setNote("");
    setError(null);
    setRestock(true);
    setRefundRemaining(false);
    setSerials(Object.fromEntries(items.map((item) => [item.id, Array.from({ length: item.quantity }, (_, unit) => item.serialNumbers[unit] ?? "")])));
    setIdempotencyKey(newIdempotencyKey());
  };

  async function submit() {
    if (!target) return;
    setError(null);
    let trackingBody: { carrierName: string; trackingNumber: string; trackingUrl: string | null } | undefined;
    if (needsTracking) {
      const parsed = trackingSchema.safeParse(tracking);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check the tracking details.");
        return;
      }
      trackingBody = parsed.data;
    }
    let serialsBody: Array<{ orderItemId: string; serialNumbers: string[] }> | undefined;
    if (capturesSerials) {
      const entries = items
        .map((item) => ({ orderItemId: item.id, serialNumbers: (serials[item.id] ?? []).map((value) => value.trim()).filter(Boolean) }))
        .filter((entry) => entry.serialNumbers.length > 0 || items.find((item) => item.id === entry.orderItemId)!.serialNumbers.length > 0);
      if (entries.length > 0) {
        const parsed = itemSerialsSchema.safeParse(entries);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the serial numbers.");
          return;
        }
        serialsBody = parsed.data;
      }
    }
    if (target === "CANCELLED" && note.trim().length < 3) {
      setError("Give a reason for the cancellation (it is shown to the customer).");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/admin/orders/${orderNumber}/transition`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: {
          to: target,
          note: note.trim() || undefined,
          ...(trackingBody ? { tracking: trackingBody } : {}),
          ...(serialsBody ? { serials: serialsBody } : {}),
          ...(target === "RETURNED" ? { restock, refundRemaining: canRefund && refundRemaining } : {}),
        },
      });
      setTarget(null);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The status could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  const forward = allowed.filter((to) => to !== "CANCELLED" && to !== "RETURNED");
  const destructive = allowed.filter((to) => to === "CANCELLED" || to === "RETURNED");

  return (
    <>
      {destructive.map((to) => (
        <Button key={to} type="button" variant="ghost" size="sm" onClick={() => open(to)} className="text-danger hover:bg-[#fdecea]">
          {ACTION_LABEL[to]}
        </Button>
      ))}
      {forward.map((to, index) => (
        <Button key={to} type="button" variant={index === 0 ? "primary" : "outline"} size="sm" onClick={() => open(to)}>
          {ACTION_LABEL[to] ?? to}
        </Button>
      ))}

      <Dialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        {target && (
          <DialogContent title={ACTION_LABEL[target] ?? "Update status"} description={`Order ${orderNumber}`}>
            <div className="space-y-4">
              {cancellingPaid && (
                <div className="flex gap-2 rounded-md border border-[#e9c46a] bg-[#fff8e1] p-3 text-sm text-[#8a5a00]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    Cancelling a paid order puts every unit back into stock and refunds{" "}
                    <strong>{formatMoney(refundableMinor, currency)}</strong> to the original payment method.
                    {blockedByPermission && " Only a super admin can issue that refund."}
                  </p>
                </div>
              )}

              {needsTracking && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Carrier</span>
                    <input value={tracking.carrierName} onChange={(event) => setTracking((value) => ({ ...value, carrierName: event.target.value }))} placeholder="Delhivery, Blue Dart…" className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium">Tracking number</span>
                    <input value={tracking.trackingNumber} onChange={(event) => setTracking((value) => ({ ...value, trackingNumber: event.target.value }))} className={inputClass} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-sm font-medium">
                      Tracking link <span className="font-normal text-muted-2">(optional)</span>
                    </span>
                    <input type="url" value={tracking.trackingUrl} onChange={(event) => setTracking((value) => ({ ...value, trackingUrl: event.target.value }))} placeholder="https://" className={inputClass} />
                  </label>
                </div>
              )}

              {capturesSerials && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">
                    Serial / IMEI numbers <span className="font-normal text-muted-2">(optional, printed on the invoice)</span>
                  </legend>
                  {items.map((item) => (
                    <div key={item.id}>
                      <p className="mb-1 text-xs text-muted-2">
                        {item.label} · <span className="font-mono">{item.sku}</span>
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(serials[item.id] ?? []).map((value, unit) => (
                          <input
                            key={unit}
                            value={value}
                            onChange={(event) =>
                              setSerials((current) => ({ ...current, [item.id]: (current[item.id] ?? []).map((entry, index) => (index === unit ? event.target.value.toUpperCase() : entry)) }))
                            }
                            aria-label={`Serial or IMEI for ${item.sku} unit ${unit + 1}`}
                            placeholder={`Unit ${unit + 1}: IMEI / serial`}
                            className={`${inputClass} font-mono`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </fieldset>
              )}

              {target === "RETURNED" && (
                <div className="space-y-2.5">
                  <label className="flex items-start gap-2.5 text-sm">
                    <Checkbox checked={restock} onCheckedChange={(value) => setRestock(value === true)} />
                    <span>
                      Put the returned units back into sellable stock
                      <span className="block text-xs text-muted-2">Leave unticked for damaged or unsellable returns.</span>
                    </span>
                  </label>
                  {canRefund && refundableMinor > 0 && (
                    <label className="flex items-start gap-2.5 text-sm">
                      <Checkbox checked={refundRemaining} onCheckedChange={(value) => setRefundRemaining(value === true)} />
                      <span>
                        Refund the remaining {formatMoney(refundableMinor, currency)}
                        <span className="block text-xs text-muted-2">For partial refunds use “Issue refund” instead.</span>
                      </span>
                    </label>
                  )}
                </div>
              )}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  {target === "CANCELLED" ? "Reason" : "Internal note"} {target !== "CANCELLED" && <span className="font-normal text-muted-2">(optional)</span>}
                </span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} className={`${inputClass} h-auto py-2`} />
              </label>

              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setTarget(null)}>
                  Back
                </Button>
                <Button type="button" size="sm" onClick={() => void submit()} loading={saving} disabled={blockedByPermission}>
                  {ACTION_LABEL[target] ?? "Confirm"}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
