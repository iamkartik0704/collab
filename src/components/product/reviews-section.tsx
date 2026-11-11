"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { reviewSchema, type ReviewInput } from "@/schemas/account";
import type { RatingBreakdown, ReviewView } from "@/types/catalog";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { RatingStars } from "./rating-stars";

const LEVELS = ["Excellent", "Good", "Average", "Below Average", "Poor"] as const;

type ReviewPage = { reviews: ReviewView[]; page: number; pageCount: number; total: number };

export function ReviewsSection({ slug, productName, breakdown }: { slug: string; productName: string; breakdown: RatingBreakdown }) {
  const [page, setPage] = useState(1);
  const { data, isFetching } = useQuery({
    queryKey: ["reviews", slug, page],
    queryFn: () => apiFetch<ReviewPage>(`/api/products/${slug}/reviews?page=${page}`),
    placeholderData: keepPreviousData,
  });

  return (
    <section id="reviews" aria-labelledby="reviews-title" className="scroll-mt-28 py-14">
      <h2 id="reviews-title" className="text-2xl font-medium">
        Reviews
      </h2>
      <div className="mt-8 flex flex-col gap-10 md:flex-row md:items-center md:gap-14">
        <div className="flex h-[192px] w-full shrink-0 flex-col items-center justify-center rounded-[var(--radius-card)] bg-surface md:w-[184px]">
          <p className="text-[56px] font-medium leading-none">{breakdown.average.toFixed(1)}</p>
          <p className="mt-2 text-sm text-muted">of {breakdown.total} reviews</p>
          <RatingStars value={breakdown.average} className="mt-3" />
        </div>
        <ul className="flex-1 space-y-4" aria-label="Rating distribution">
          {LEVELS.map((level, index) => {
            const count = breakdown.counts[index] ?? 0;
            const pct = breakdown.total ? Math.round((count / breakdown.total) * 100) : 0;
            return (
              <li key={level} className="grid grid-cols-[120px_1fr_36px] items-center gap-4 text-[15px] md:grid-cols-[160px_1fr_40px]">
                <span className="font-medium">{level}</span>
                <span className="h-[5px] overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${level}: ${count} reviews`}>
                  <span className="block h-full rounded-full bg-star" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-right text-muted">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <ReviewForm slug={slug} productName={productName} />

      <ul className={cn("mt-10 space-y-6 transition-opacity", isFetching && "opacity-60")}>
        {data?.reviews.map((review) => (
          <li key={review.id} className="rounded-[var(--radius-card)] bg-surface p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white" aria-hidden>
                  {review.author.slice(0, 1)}
                </span>
                <div>
                  <p className="text-base font-semibold">{review.author}</p>
                  {review.isVerifiedPurchase && (
                    <p className="flex items-center gap-1 text-xs font-medium text-success">
                      <BadgeCheck className="size-3.5" aria-hidden /> Verified purchase
                    </p>
                  )}
                </div>
              </div>
              <time dateTime={review.createdAt} className="text-sm text-muted">
                {new Date(review.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </time>
            </div>
            <RatingStars value={review.rating} className="mt-3" />
            <p className="mt-3 font-medium">{review.title}</p>
            <p className="mt-1 whitespace-pre-line text-[15px] leading-6 text-muted-2">{review.body}</p>
          </li>
        ))}
        {data && data.total === 0 && <li className="rounded-[var(--radius-card)] bg-surface p-8 text-center text-muted-2">No reviews yet — be the first to share your experience.</li>}
      </ul>

      {data && data.pageCount > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-2">
            Page {data.page} of {data.pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.pageCount} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}

function ReviewForm({ slug, productName }: { slug: string; productName: string }) {
  const { data: session, isLoading } = useSession();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ status: "APPROVED" | "PENDING" } | null>(null);
  const form = useForm<ReviewInput>({ resolver: zodResolver(reviewSchema), defaultValues: { rating: 0, title: "", body: "" } });

  const submit = useMutation({
    mutationFn: (values: ReviewInput) => apiFetch<{ status: "APPROVED" | "PENDING" }>(`/api/products/${slug}/reviews`, { method: "POST", body: values }),
    onSuccess: (data) => setResult(data),
    onError: (error) => form.setError("root", { message: error instanceof ApiClientError ? error.message : "Could not submit your review." }),
  });

  if (isLoading) return null;
  if (result) {
    return (
      <p role="status" className="mt-8 rounded-[var(--radius-card)] bg-surface p-4 text-sm">
        {result.status === "APPROVED" ? "Thanks! Your verified review is live." : "Thanks! Your review will appear once our team has checked it."}
      </p>
    );
  }
  if (!session) {
    return (
      <p className="mt-8 text-sm text-muted-2">
        <Link href={`/login?callbackUrl=/products/${slug}%23reviews`} className="font-medium text-ink underline underline-offset-4">
          Sign in
        </Link>{" "}
        to review {productName}.
      </p>
    );
  }
  if (!open) {
    return (
      <Button variant="outline" className="mt-8" onClick={() => setOpen(true)}>
        Write a review
      </Button>
    );
  }

  return (
    <form onSubmit={form.handleSubmit((values) => submit.mutate(values))} className="mt-8 space-y-4 rounded-[var(--radius-card)] border border-line p-6" noValidate>
      <div>
        <Label id="rating-label">Your rating</Label>
        <Controller
          control={form.control}
          name="rating"
          render={({ field }) => (
            <div role="radiogroup" aria-labelledby="rating-label" className="flex gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" role="radio" aria-checked={field.value === value} aria-label={`${value} star${value > 1 ? "s" : ""}`} onClick={() => field.onChange(value)}>
                  <Star className={cn("size-7 transition-colors", value <= (field.value ?? 0) ? "fill-star text-star" : "fill-line-2 text-line-2")} />
                </button>
              ))}
            </div>
          )}
        />
        <FieldError message={form.formState.errors.rating?.message} />
      </div>
      <div>
        <Label htmlFor="review-title">Title</Label>
        <Input id="review-title" {...form.register("title")} invalid={Boolean(form.formState.errors.title)} />
        <FieldError message={form.formState.errors.title?.message} />
      </div>
      <div>
        <Label htmlFor="review-body">Review</Label>
        <textarea
          id="review-body"
          rows={5}
          {...form.register("body")}
          className="w-full rounded-[7px] border border-line-2 px-4 py-3 text-sm focus:border-ink focus:outline-none"
        />
        <FieldError message={form.formState.errors.body?.message} />
      </div>
      <FieldError message={form.formState.errors.root?.message} />
      <div className="flex gap-3">
        <Button type="submit" loading={submit.isPending}>
          Submit review
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
