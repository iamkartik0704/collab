"use client";

import { ExternalLink, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { trackingSchema } from "@/schemas/admin";

interface TrackingValues {
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string;
}

export function TrackingForm({ orderNumber, editable, initial }: { orderNumber: string; editable: boolean; initial: TrackingValues }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasTracking = Boolean(initial.carrierName && initial.trackingNumber);

  async function save() {
    const parsed = trackingSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the tracking details.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/orders/${orderNumber}/tracking`, { method: "PATCH", body: parsed.data });
      setEditing(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiClientError ? failure.message : "Could not save tracking.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <Truck className="size-4 text-muted-2" aria-hidden /> Tracking
          </p>
          {hasTracking ? (
            <>
              <p className="mt-1">{initial.carrierName}</p>
              <p className="font-mono text-xs">{initial.trackingNumber}</p>
              {initial.trackingUrl && (
                <a href={initial.trackingUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2">
                  Track shipment <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-2">Not added yet. Required before the order can be marked shipped.</p>
          )}
        </div>
        {editable && (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} className="h-8 px-3 text-xs">
            {hasTracking ? "Edit" : "Add"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium">Carrier</span>
        <input value={values.carrierName} onChange={(event) => setValues((v) => ({ ...v, carrierName: event.target.value }))} className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium">Tracking number</span>
        <input value={values.trackingNumber} onChange={(event) => setValues((v) => ({ ...v, trackingNumber: event.target.value }))} className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium">Tracking link (https)</span>
        <input type="url" value={values.trackingUrl} onChange={(event) => setValues((v) => ({ ...v, trackingUrl: event.target.value }))} className={inputClass} />
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValues(initial);
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} loading={saving}>
          Save tracking
        </Button>
      </div>
    </div>
  );
}
