import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingStars({ value, size = "sm", className }: { value: number; size?: "sm" | "md"; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(size === "sm" ? "size-4" : "size-5", star <= full ? "fill-star text-star" : "fill-line-2 text-line-2")}
          aria-hidden
        />
      ))}
    </span>
  );
}
