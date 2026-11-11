import type { Job, Worker } from "bullmq";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { AiJob, enqueueKnowledgeReindex, getQueue, QueueName, reindexProductJobSchema } from "@/queues";
import { indexProduct, reindexAll } from "@/server/ai/rag";
import { startWorker } from "./runtime";

/** Keeps the support agent's RAG index in sync with the catalogue and policy documents. */

const log = childLogger({ worker: QueueName.ai });

async function process(job: Job): Promise<string> {
  switch (job.name) {
    case AiJob.reindexProduct: {
      const { productId } = reindexProductJobSchema.parse(job.data);
      const result = await indexProduct(productId);
      return `chunks:${result.written} embedded:${result.embedded}`;
    }
    case AiJob.reindexAll: {
      const result = await reindexAll();
      log.info(result, "knowledge base reindexed");
      return `products:${result.products} chunks:${result.written} embedded:${result.embedded}`;
    }
    default:
      throw new Error(`Unknown ai job "${job.name}"`);
  }
}

export async function startAiWorker(): Promise<Worker> {
  // Nightly full pass picks up policy edits and backfills embeddings that failed earlier.
  await getQueue(QueueName.ai).upsertJobScheduler(
    "reindex-all-nightly",
    { pattern: "30 2 * * *", tz: "Asia/Kolkata" },
    { name: AiJob.reindexAll, opts: { attempts: 3, removeOnComplete: 20, removeOnFail: 20 } },
  );
  // Fresh database: build the index now instead of waiting for the night.
  if ((await db.knowledgeChunk.count()) === 0) await enqueueKnowledgeReindex();
  return startWorker({ queue: QueueName.ai, processor: process, alertType: "WEBHOOK_FAILURE", concurrency: 2 });
}
