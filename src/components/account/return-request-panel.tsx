"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { returnRequestInputSchema } from "@/schemas/returns";

interface EligibleItem {
  id: string;
  label: string;
  returnableQuantity: number;
  canReturn: boolean;
  canWarranty: boolean;
  returnWindowEndsAt: string | null;
  warrantyEndsAt: string | null;
}

const REASONS = [
  ["DEFECTIVE", "Defective or not working"],
  ["DAMAGED_IN_TRANSIT", "Arrived damaged"],
  ["WRONG_ITEM", "Wrong item or variant"],
  ["NOT_AS_DESCRIBED", "Not as described"],
  ["CHANGED_MIND", "No longer needed (unopened)"],
  ["WARRANTY_FAULT", "Developed a fault (warranty)"],
] as const;

const fieldClass = "h-11 w-full rounded-[7px] border border-line-2 bg-white px-3 text-sm focus:border-ink focus:outline-none";
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Return / replacement / warranty request form for a delivered order. */
export function ReturnRequestPanel({ orderNumber, items }: { orderNumber: string; items: EligibleItem[] }) {
  const router = useRouter();
  const eligible = items.filter((item) => item.canReturn || item.canWarranty);
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(eligible[0]?.id ?? "");
  const [type, setType] = useState<"RETURN" | "REPLACEMENT" | "WARRANTY_REPAIR">(eligible[0]?.canReturn ? "RETURN" : "WARRANTY_REPAIR");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("DEFECTIVE");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const item = items.find((entry) => entry.id === itemId);
  const types = [
    ...(item?.canReturn ? ([["RETURN", "Return for a refund"], ["REPLACEMENT", "Replacement"]] as const) : []),
    ...(item?.canWarranty ? ([["WARRANTY_REPAIR", "Warranty repair / claim"]] as const) : []),
  ];

  if (eligible.length === 0) {
    return (
      <p className="mt-8 rounded-[var(--radius-card)] bg-surface p-4 text-sm text-muted-2">
        Returns are accepted within 7 days of delivery and warranty claims during the warranty period. Nothing on this order is eligible right now; for help, contact support.
      </p>
    );
  }

  async function submit() {
    setError(null);
    const body = { orderItemId: itemId, type, quantity, reason, description: description.trim() };
    const parsed = returnRequestInputSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the request details.");
      return;
    }
    setPending(true);
    try {
      const result = await apiFetch<{ rmaNumber: string }>(`/api/account/orders/${orderNumber}/returns`, { method: "POST", body });
      setDone(result.rmaNumber);
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "The request could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="return-title" className="mt-8 rounded-[var(--radius-card)] border border-line p-5">
      <h2 id="return-title" className="text-xl font-medium">
        Return or warranty request
      </h2>
      {done && (
        <p role="status" className="mt-2 text-sm text-success">
          Request {done} received. We review requests within one business day and will update this page.
        </p>
      )}
      {!open ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          Start a request
        </Button>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Item</span>
            <select
              value={itemId}
              onChange={(event) => {
                const next = items.find((entry) => entry.id === event.target.value);
                setItemId(event.target.value);
                setQuantity(1);
                if (next && !next.canReturn) setType("WARRANTY_REPAIR");
                if (next && !next.canWarranty && type === "WARRANTY_REPAIR") setType("RETURN");
              }}
              className={fieldClass}
            >
              {eligible.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            {item && (
              <span className="mt-1 block text-xs text-muted-2">
                {item.canReturn && item.returnWindowEndsAt ? `Returns until ${dateFormat.format(new Date(item.returnWindowEndsAt))}. ` : ""}
                {item.warrantyEndsAt ? `Warranty until ${dateFormat.format(new Date(item.warrantyEndsAt))}.` : ""}
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Request</span>
            <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className={fieldClass}>
              {types.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Quantity</span>
            <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className={fieldClass}>
              {Array.from({ length: Math.max(1, item?.returnableQuantity ?? 1) }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Reason</span>
            <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)} className={fieldClass}>
              {REASONS.filter(([value]) => (type === "WARRANTY_REPAIR" ? value !== "CHANGED_MIND" : true)).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">What&apos;s wrong?</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Describe the defect or damage: when it started, what happens, any error messages."
              className="w-full rounded-[7px] border border-line-2 px-3 py-2 text-sm focus:border-ink focus:outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="button" size="sm" onClick={() => void submit()} loading={pending}>
              Submit request
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
