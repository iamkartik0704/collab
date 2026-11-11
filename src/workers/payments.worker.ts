import type { Job, Worker } from "bullmq";
import { PaymentJob, QueueName, refundJobSchema } from "@/queues";
import { executeRefund } from "@/server/payments/payment-events.service";
import { startWorker } from "./runtime";

/**
 * Provider refund calls. executeRefund is idempotent (skips refunds that already have a
 * provider id and forwards Refund.idempotencyKey to the provider), so retries never double-pay.
 * A refund that keeps failing raises a PAYMENT_ANOMALY alert; admins can re-queue it from the
 * order page once the cause (e.g. a provider outage) is resolved.
 */
async function process(job: Job): Promise<string> {
  if (job.name !== PaymentJob.executeRefund) throw new Error(`Unknown payments job "${job.name}"`);
  const { refundId } = refundJobSchema.parse(job.data);
  await executeRefund(refundId);
  return "executed";
}

export function startPaymentsWorker(): Worker {
  return startWorker({ queue: QueueName.payments, processor: process, alertType: "PAYMENT_ANOMALY", concurrency: 4 });
}
