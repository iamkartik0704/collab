import { Worker, type Job } from "bullmq";
import { env } from "@/env";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { createBullMQConnection } from "@/lib/redis";
import { getQueue, InventoryJob, QueueName, releaseReservationJobSchema, scheduleReservationExpiry } from "@/queues";
import { cancelPendingOrder, sweepExpiredReservations } from "@/server/orders/expiry.service";

const log = childLogger({ worker: QueueName.inventory });

const SWEEP_SCHEDULER_ID = "sweep-expired-reservations";
const SWEEP_EVERY_MS = 60_000;

async function processJob(job: Job): Promise<string> {
  switch (job.name) {
    case InventoryJob.releaseExpiredReservation: {
      const { orderId, reason } = releaseReservationJobSchema.parse(job.data);
      const outcome = await cancelPendingOrder(orderId, reason === "expired" ? "payment_window_expired" : "payment_cancelled");
      if (outcome.status === "not_due") {
        // Clock skew / early delivery: try again when the reservation actually lapses.
        await scheduleReservationExpiry(orderId, outcome.dueAt, { reschedule: true });
      }
      return outcome.status;
    }
    case InventoryJob.sweepExpiredReservations: {
      const cancelled = await sweepExpiredReservations();
      if (cancelled > 0) log.warn({ cancelled }, "sweeper released reservations whose expiry job was missed");
      return `cancelled:${cancelled}`;
    }
    default:
      throw new Error(`Unknown inventory job "${job.name}"`);
  }
}

/** Dead-letter handling: a job that exhausted its retries raises an admin alert. */
async function onFinalFailure(job: Job, error: Error): Promise<void> {
  log.error({ err: error, jobId: job.id, jobName: job.name, attempts: job.attemptsMade }, "inventory job dead-lettered");
  await db.adminAlert.createMany({
    data: [
      {
        type: "WEBHOOK_FAILURE",
        severity: "CRITICAL",
        title: `Inventory job failed: ${job.name}`,
        message: `Job ${job.id} failed ${job.attemptsMade} times: ${error.message}`.slice(0, 1000),
        entityType: "BullMQJob",
        entityId: String(job.id).slice(0, 64),
        dedupeKey: `dlq:${QueueName.inventory}:${job.id}`.slice(0, 160),
      },
    ],
    skipDuplicates: true,
  });
}

export async function startInventoryWorker(): Promise<Worker> {
  await getQueue(QueueName.inventory).upsertJobScheduler(
    SWEEP_SCHEDULER_ID,
    { every: SWEEP_EVERY_MS },
    { name: InventoryJob.sweepExpiredReservations, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } },
  );

  const worker = new Worker(QueueName.inventory, processJob, {
    connection: createBullMQConnection("worker", QueueName.inventory),
    concurrency: env.WORKER_CONCURRENCY ?? 10,
  });

  worker.on("completed", (job, result) => log.debug({ jobId: job.id, jobName: job.name, result }, "job completed"));
  worker.on("failed", (job, error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void onFinalFailure(job, error).catch((alertError: unknown) => log.error({ err: alertError }, "failed to record DLQ alert"));
    } else {
      log.warn({ err: error, jobId: job.id, attempt: job.attemptsMade }, "job failed; will retry");
    }
  });
  worker.on("error", (error) => log.error({ err: error }, "worker error"));

  log.info({ concurrency: env.WORKER_CONCURRENCY ?? 10 }, "inventory worker started");
  return worker;
}
