"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn, formatMoney } from "@/lib/utils";
import { DELIVERY_SLOTS, type DeliverySlot } from "@/schemas/checkout";

export interface ShippingMethodView {
  code: string;
  name: string;
  description: string | null;
  speed: "STANDARD" | "EXPRESS" | "SCHEDULED";
  priceMinor: number;
  freeAboveMinor: number | null;
  minDays: number;
  maxDays: number;
  requiresSlot: boolean;
}

export interface ScheduleValue {
  date: string;
  slot: DeliverySlot | "";
}

function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function prettyDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function ShippingStep({
  methods,
  goodsTotalMinor,
  currency,
  selected,
  onSelect,
  schedule,
  onScheduleChange,
}: {
  methods: ShippingMethodView[];
  goodsTotalMinor: number;
  currency: string;
  selected: string | null;
  onSelect: (code: string) => void;
  schedule: ScheduleValue;
  onScheduleChange: (value: ScheduleValue) => void;
}) {
  return (
    <section aria-labelledby="shipping-title">
      <h2 id="shipping-title" className="text-xl font-semibold">
        Shipment Method
      </h2>
      <RadioGroupPrimitive.Root value={selected ?? ""} onValueChange={onSelect} className="mt-8 space-y-4" aria-label="Delivery options">
        {methods.map((method) => {
          const free = method.freeAboveMinor !== null && goodsTotalMinor >= method.freeAboveMinor;
          const price = free ? "Free" : formatMoney(method.priceMinor, currency);
          const active = selected === method.code;
          return (
            <div key={method.code} className={cn("rounded-[11px] border p-6 transition-colors", active ? "border-ink" : "border-line-2")}>
              <div className="flex items-center gap-4">
                <RadioGroupPrimitive.Item
                  value={method.code}
                  id={`ship-${method.code}`}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white"
                >
                  <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-ink" />
                </RadioGroupPrimitive.Item>
                <label htmlFor={`ship-${method.code}`} className="flex flex-1 cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{price}</span>
                    <span>{method.description ?? method.name}</span>
                  </span>
                  <span className="text-sm text-ink">{method.requiresSlot ? "Select Date" : prettyDate(method.maxDays)}</span>
                </label>
              </div>
              {method.requiresSlot && active && (
                <div className="mt-5 grid gap-4 pl-9 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1.5 block font-medium">Delivery date</span>
                    <input
                      type="date"
                      required
                      min={isoDate(method.minDays)}
                      max={isoDate(method.maxDays)}
                      value={schedule.date}
                      onChange={(event) => onScheduleChange({ ...schedule, date: event.target.value })}
                      className="h-12 w-full rounded-[7px] border border-line-2 px-3 focus:border-ink focus:outline-none"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1.5 block font-medium">Time slot</span>
                    <select
                      required
                      value={schedule.slot}
                      onChange={(event) => onScheduleChange({ ...schedule, slot: event.target.value as DeliverySlot | "" })}
                      className="h-12 w-full rounded-[7px] border border-line-2 bg-white px-3 focus:border-ink focus:outline-none"
                    >
                      <option value="">Choose a slot</option>
                      {DELIVERY_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </RadioGroupPrimitive.Root>
    </section>
  );
}
