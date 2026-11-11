import type { Job, Worker } from "bullmq";
import { AnalyticsJob, getQueue, QueueName } from "@/queues";
import { rollupRecentMetrics } from "@/server/admin/analytics.service";
import { startWorker } from "./runtime";

/** Keeps DailyMetric (dashboard KPIs and charts) fresh for today and yesterday. */
const ROLLUP_EVERY_MS = 15 * 60_000;

async function process(job: Job): Promise<string> {
  if (job.name !== AnalyticsJob.rollupDailyMetrics) throw new Error(`Unknown analytics job "${job.name}"`);
  return `rows:${await rollupRecentMetrics()}`;
}

export async function startAnalyticsWorker(): Promise<Worker> {
  await getQueue(QueueName.analytics).upsertJobScheduler(
    "rollup-daily-metrics",
    { every: ROLLUP_EVERY_MS },
    { name: AnalyticsJob.rollupDailyMetrics, opts: { attempts: 2, removeOnComplete: 100, removeOnFail: 100 } },
  );
  return startWorker({ queue: QueueName.analytics, processor: process, alertType: "WEBHOOK_FAILURE", concurrency: 1 });
}
