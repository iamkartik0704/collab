import { CreditCard, MapPin, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Address", icon: MapPin },
  { label: "Shipping", icon: Truck },
  { label: "Payment", icon: CreditCard },
] as const;

export function CheckoutStepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="flex items-center justify-between gap-4 py-8 lg:py-[72px]" aria-label="Checkout progress">
      {STEPS.map((step, index) => {
        const number = (index + 1) as 1 | 2 | 3;
        const state = number < current ? "done" : number === current ? "current" : "todo";
        const Icon = step.icon;
        return (
          <li key={step.label} aria-current={state === "current" ? "step" : undefined} className={cn("flex items-center gap-2", state === "todo" ? "text-muted" : "text-ink", state !== "current" && "hidden sm:flex")}>
            <span className={cn("flex size-6 items-center justify-center rounded-full", state === "todo" ? "bg-muted" : "bg-ink")}>
              <Icon className="size-3.5 text-white" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-medium">Step {number}</span>
              <span className="block text-xl font-medium">{step.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
