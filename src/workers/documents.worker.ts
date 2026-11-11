import type { Job, Worker } from "bullmq";
import { creditNoteJobSchema, DocumentJob, enqueueCreditNote, getQueue, QueueName } from "@/queues";
import { ensureCreditNote, refundsMissingCreditNotes } from "@/server/invoices/invoice.service";
import { startWorker } from "./runtime";

/** GST documents: a credit note for every successful refund (event-driven + hourly backfill). */
async function process(job: Job): Promise<string> {
  switch (job.name) {
    case DocumentJob.issueCreditNote: {
      const { refundId } = creditNoteJobSchema.parse(job.data);
      const note = await ensureCreditNote(refundId);
      return note.creditNoteNumber;
    }
    case DocumentJob.sweepCreditNotes: {
      const missing = await refundsMissingCreditNotes();
      for (const refundId of missing) await enqueueCreditNote(refundId);
      return `queued:${missing.length}`;
    }
    default:
      throw new Error(`Unknown documents job "${job.name}"`);
  }
}

export async function startDocumentsWorker(): Promise<Worker> {
  await getQueue(QueueName.documents).upsertJobScheduler(
    "sweep-credit-notes",
    { every: 60 * 60_000 },
    { name: DocumentJob.sweepCreditNotes, opts: { attempts: 1, removeOnComplete: 50, removeOnFail: 50 } },
  );
  return startWorker({ queue: QueueName.documents, processor: process, alertType: "PAYMENT_ANOMALY", concurrency: 2 });
}
