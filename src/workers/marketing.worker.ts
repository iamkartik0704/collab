import type { Job, Worker } from "bullmq";
import { getQueue, MarketingJob, QueueName } from "@/queues";
import { sendAbandonedCartReminders } from "@/server/marketing/abandoned-cart.service";
import { startWorker } from "./runtime";

/** Repeatable marketing jobs: abandoned-cart reminders every 15 minutes (carts idle 2+ hours). */
const EVERY_MS = 15 * 60_000;

async function process(job: Job): Promise<string> {
  if (job.name !== MarketingJob.abandonedCartReminders) throw new Error(`Unknown marketing job "${job.name}"`);
  const result = await sendAbandonedCartReminders();
  return `considered:${result.considered} reminded:${result.reminded} skipped:${result.skipped}`;
}

export async function startMarketingWorker(): Promise<Worker> {
  await getQueue(QueueName.marketing).upsertJobScheduler(
    "abandoned-cart-reminders",
    { every: EVERY_MS },
    { name: MarketingJob.abandonedCartReminders, opts: { attempts: 2, removeOnComplete: 100, removeOnFail: 100 } },
  );
  return startWorker({ queue: QueueName.marketing, processor: process, alertType: "NOTIFICATION_DEAD_LETTER", concurrency: 1 });
}
