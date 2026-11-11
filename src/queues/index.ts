import { NotificationChannel, NotificationType } from "@prisma/client";
import { Queue, type JobsOptions } from "bullmq";
import { z } from "zod";
import { createBullMQConnection } from "@/lib/redis";

/**
 * Queue topology. Producers live in the web app; consumers live in src/workers.
 *   inventory      release-expired-reservation (delayed 15 min), sweep-expired-reservations (every minute)
 *   notifications  WhatsApp + email deliveries (OTP, order updates, low-stock alerts, ...)
 *   ai             reindex-product / reindex-all (pgvector RAG index for the support agent)
 *   payments       execute-refund (provider refund calls with retries)
 *   analytics      rollup-daily-metrics (every 15 min: DailyMetric for today + yesterday)
 *   documents      issue-credit-note (on refund success), sweep-credit-notes (hourly backfill)
 *   marketing      abandoned-cart-reminders (every 15 min)
 * Job ids never contain ':' (BullMQ reserves it as a key separator).
 */

export const QueueName = {
  inventory: "inventory",
  notifications: "notifications",
  payments: "payments",
  ai: "ai",
  analytics: "analytics",
  documents: "documents",
  marketing: "marketing",
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const InventoryJob = {
  releaseExpiredReservation: "release-expired-reservation",
  sweepExpiredReservations: "sweep-expired-reservations",
} as const;

export const PaymentJob = {
  executeRefund: "execute-refund",
} as const;

export const AiJob = {
  reindexProduct: "reindex-product",
  reindexAll: "reindex-all",
} as const;

export const DocumentJob = {
  issueCreditNote: "issue-credit-note",
  sweepCreditNotes: "sweep-credit-notes",
} as const;

export const MarketingJob = {
  abandonedCartReminders: "abandoned-cart-reminders",
} as const;

export const creditNoteJobSchema = z.object({ refundId: z.string().min(1) });

export const AnalyticsJob = {
  rollupDailyMetrics: "rollup-daily-metrics",
} as const;

export const reindexProductJobSchema = z.object({ productId: z.string().min(1) });

export const refundJobSchema = z.object({ refundId: z.string().min(1) });

export const NotificationJob = {
  deliver: "deliver",
} as const;

export const releaseReservationJobSchema = z.object({
  orderId: z.string().min(1),
  /** "expired": the 15-minute window lapsed; "payment_cancelled": terminal payment failure. */
  reason: z.enum(["expired", "payment_cancelled"]).default("expired"),
});
export type ReleaseReservationJob = z.infer<typeof releaseReservationJobSchema>;

export const notificationJobSchema = z.object({
  notificationLogId: z.string().min(1),
  type: z.enum(NotificationType),
  channel: z.enum(NotificationChannel),
  recipient: z.string().min(3).max(320),
  templateData: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type NotificationJobData = z.infer<typeof notificationJobSchema>;

/** Spec: 5 attempts, exponential backoff from 3 s. Failed jobs are kept 7 days (DLQ). */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 3_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

const globalForQueues = globalThis as unknown as { __collabQueues?: Map<QueueName, Queue> };
const queues: Map<QueueName, Queue> = globalForQueues.__collabQueues ?? new Map();
globalForQueues.__collabQueues = queues;

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: createBullMQConnection("producer", name),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  return queue;
}

const reservationJobId = (orderId: string) => `release-${orderId}`;

/**
 * Schedules the release of an order's reservations at `expiresAt` (+1 s grace). Deterministic
 * job id: scheduling twice for the same order is a no-op.
 */
export async function scheduleReservationExpiry(orderId: string, expiresAt: Date, options: { reschedule?: boolean } = {}): Promise<void> {
  const data: ReleaseReservationJob = { orderId, reason: "expired" };
  await getQueue(QueueName.inventory).add(InventoryJob.releaseExpiredReservation, data, {
    // A job cannot re-add its own id while running, so reschedules get a distinct one.
    jobId: options.reschedule ? `${reservationJobId(orderId)}-${expiresAt.getTime()}` : reservationJobId(orderId),
    delay: Math.max(0, expiresAt.getTime() - Date.now() + 1_000),
  });
}

/** Releases an order's reservations immediately (terminal payment failure / cancellation). */
export async function enqueueImmediateRelease(orderId: string): Promise<void> {
  const data: ReleaseReservationJob = { orderId, reason: "payment_cancelled" };
  await getQueue(QueueName.inventory).add(InventoryJob.releaseExpiredReservation, data, {
    jobId: `release-now-${orderId}`,
  });
}

/** Removes the pending expiry job once the order is paid (the job is also a no-op then). */
export async function cancelReservationExpiry(orderId: string): Promise<void> {
  const job = await getQueue(QueueName.inventory).getJob(reservationJobId(orderId));
  if (job && (await job.isDelayed())) {
    await job.remove();
  }
}

export async function enqueueNotificationJob(data: NotificationJobData): Promise<void> {
  const payload = notificationJobSchema.parse(data);
  await getQueue(QueueName.notifications).add(NotificationJob.deliver, payload, {
    jobId: `notification-${payload.notificationLogId}`,
    // OTP codes must not linger in Redis.
    ...(payload.type === "OTP" ? { removeOnComplete: true, removeOnFail: { age: 60 * 60 } } : {}),
  });
}

/**
 * Sends a PENDING refund to its payment provider with retries (5 attempts, exponential
 * backoff). The provider call is idempotent per refund, so retries never double-refund.
 */
export async function enqueueRefundExecution(refundId: string): Promise<void> {
  const queue = getQueue(QueueName.payments);
  const jobId = `refund-${refundId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") return existing.retry();
    if (state !== "completed") return; // already waiting / running
    await existing.remove();
  }
  await queue.add(PaymentJob.executeRefund, refundJobSchema.parse({ refundId }), { jobId });
}

/**
 * Re-embeds one product's knowledge chunks for the support agent's RAG index. Debounced:
 * repeated saves within 30 s collapse into one job.
 */
export async function enqueueProductReindex(productId: string): Promise<void> {
  const queue = getQueue(QueueName.ai);
  const jobId = `reindex-${productId}`;
  const existing = await queue.getJob(jobId);
  if (existing && (await existing.isDelayed())) return;
  if (existing) await existing.remove().catch(() => undefined);
  await queue.add(AiJob.reindexProduct, reindexProductJobSchema.parse({ productId }), { jobId, delay: 30_000 });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}

/** Rebuilds the whole RAG corpus (policies, FAQs, every active product). Collapses duplicates. */
export async function enqueueKnowledgeReindex(): Promise<void> {
  const queue = getQueue(QueueName.ai);
  const existing = await queue.getJob("reindex-all");
  if (existing) {
    const state = await existing.getState();
    if (state === "waiting" || state === "active" || state === "delayed") return;
    await existing.remove().catch(() => undefined);
  }
  await queue.add(AiJob.reindexAll, {}, { jobId: "reindex-all", attempts: 3 });
}

/** Issues the GST credit note for a refund that just succeeded (deterministic id: once per refund). */
export async function enqueueCreditNote(refundId: string): Promise<void> {
  await getQueue(QueueName.documents).add(DocumentJob.issueCreditNote, creditNoteJobSchema.parse({ refundId }), { jobId: `credit-note-${refundId}` });
}
