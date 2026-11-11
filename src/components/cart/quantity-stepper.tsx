"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** − qty + stepper. The + button is disabled at the stock / per-line limit. */
export function QuantityStepper({
  value,
  max,
  onChange,
  disabled,
  label,
  className,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)} role="group" aria-label={`Quantity for ${label}`}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 1}
        className="flex size-6 items-center justify-center rounded text-ink transition-opacity hover:bg-surface disabled:opacity-30"
        aria-label="Decrease quantity"
      >
        <Minus className="size-4" />
      </button>
      <span className="flex h-8 min-w-10 items-center justify-center rounded border border-line-2 px-2 text-sm font-medium" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        className="flex size-6 items-center justify-center rounded text-ink transition-opacity hover:bg-surface disabled:opacity-30"
        aria-label="Increase quantity"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
