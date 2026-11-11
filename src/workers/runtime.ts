import type { AdminAlertType } from "@prisma/client";
import { Worker, type Job, type Processor } from "bullmq";
import { env } from "@/env";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { createBullMQConnection } from "@/lib/redis";
import type { QueueName } from "@/queues";

/**
 * Shared consumer wiring: concurrency, structured logs, and dead-letter handling. A job that
 * exhausts its retries (or throws bullmq's UnrecoverableError) is kept in the failed set for
 * 7 days (DEFAULT_JOB_OPTIONS) and raises one deduplicated admin alert.
 */

export interface WorkerSpec {
  queue: QueueName;
  processor: Processor;
  alertType: AdminAlertType;
  concurrency?: number;
  /** Extra dead-letter handling (e.g. mark a NotificationLog DEAD_LETTERED). */
  onDeadLetter?: (job: Job, error: Error) => Promise<void>;
}

export function isFinalFailure(job: Job, error: Error): boolean {
  return error.name === "UnrecoverableError" || job.attemptsMade >= (job.opts.attempts ?? 1);
}

export function startWorker(spec: WorkerSpec): Worker {
  const log = childLogger({ worker: spec.queue });
  const concurrency = spec.concurrency ?? env.WORKER_CONCURRENCY ?? 10;
  const worker = new Worker(spec.queue, spec.processor, {
    connection: createBullMQConnection("worker", spec.queue),
    concurrency,
  });

  worker.on("completed", (job, result) => log.debug({ jobId: job.id, jobName: job.name, result }, "job completed"));
  worker.on("failed", (job, error) => {
    if (!job) return;
    if (!isFinalFailure(job, error)) {
      log.warn({ err: error, jobId: job.id, jobName: job.name, attempt: job.attemptsMade }, "job failed; will retry");
      return;
    }
    log.error({ err: error, jobId: job.id, jobName: job.name, attempts: job.attemptsMade }, "job dead-lettered");
    void (async () => {
      await spec.onDeadLetter?.(job, error);
      await db.adminAlert.createMany({
        data: [
          {
            type: spec.alertType,
            severity: "CRITICAL",
            title: `${spec.queue} job failed: ${job.name}`,
            message: `Job ${job.id} failed after ${job.attemptsMade} attempt(s): ${error.message}`.slice(0, 1000),
            entityType: "BullMQJob",
            entityId: String(job.id).slice(0, 64),
            dedupeKey: `dlq:${spec.queue}:${job.id}`.slice(0, 160),
          },
        ],
        skipDuplicates: true,
      });
    })().catch((alertError: unknown) => log.error({ err: alertError }, "failed to record dead-letter alert"));
  });
  worker.on("error", (error) => log.error({ err: error }, "worker error"));
  log.info({ concurrency }, "worker started");
  return worker;
}
