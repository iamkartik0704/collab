import type { Worker } from "bullmq";
import { disconnectDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { disconnectRedis } from "@/lib/redis";
import { closeQueues } from "@/queues";
import { startAiWorker } from "./ai.worker";
import { startAnalyticsWorker } from "./analytics.worker";
import { startDocumentsWorker } from "./documents.worker";
import { startInventoryWorker } from "./inventory.worker";
import { startMarketingWorker } from "./marketing.worker";
import { startNotificationsWorker } from "./notifications.worker";
import { startPaymentsWorker } from "./payments.worker";

/**
 * BullMQ worker process (Dockerfile.worker). Run locally with `npm run worker:dev`.
 * Consumers:
 *   inventory      reservation expiry + one-minute sweeper
 *   notifications  email (Resend / SMTP) and WhatsApp template delivery, invoice attachments
 *   payments       provider refund execution
 *   ai             RAG index (per-product reindex on save, nightly full pass)
 *   analytics      DailyMetric rollups every 15 minutes
 *   documents      GST credit notes for successful refunds (+ hourly backfill)
 *   marketing      abandoned-cart reminders every 15 minutes
 * Every consumer retries with exponential backoff and dead-letters into an admin alert.
 */

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const workers: Worker[] = [
    await startInventoryWorker(),
    startNotificationsWorker(),
    startPaymentsWorker(),
    await startAiWorker(),
    await startAnalyticsWorker(),
    await startDocumentsWorker(),
    await startMarketingWorker(),
  ];
  logger.info({ queues: workers.map((worker) => worker.name) }, "all workers running");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "worker shutting down; finishing active jobs");
    const forceExit = setTimeout(() => {
      logger.error("graceful shutdown timed out; exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    try {
      await Promise.all(workers.map((worker) => worker.close()));
      await closeQueues();
      await disconnectDatabase();
      await disconnectRedis();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandled rejection in worker"));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
