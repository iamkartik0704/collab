import type { WebhookSource } from "@prisma/client";
import { sha256Hex } from "@/lib/crypto";
import { db, isUniqueConstraintError } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Exactly-once webhook processing on top of at-least-once delivery.
 * ProcessedWebhook has UNIQUE(source, eventId):
 *   new event               -> insert PROCESSING, caller processes it
 *   PROCESSED               -> duplicate, acknowledge without side effects
 *   FAILED                  -> reclaimed for another attempt (provider retry)
 *   PROCESSING (fresh)      -> another worker has it; ask the provider to retry later
 *   PROCESSING (stale >5m)  -> the previous worker died; reclaimed
 */

const STALE_PROCESSING_MS = 5 * 60 * 1000;

export type WebhookClaim = "process" | "duplicate" | "in_progress";

export async function claimWebhookEvent(source: WebhookSource, eventId: string, eventType: string, rawBody: string): Promise<WebhookClaim> {
  const payloadHash = sha256Hex(rawBody);
  try {
    await db.processedWebhook.create({
      data: { source, eventId: eventId.slice(0, 255), eventType: eventType.slice(0, 100), payloadHash, status: "PROCESSING" },
    });
    return "process";
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const existing = await db.processedWebhook.findUniqueOrThrow({
    where: { source_eventId: { source, eventId: eventId.slice(0, 255) } },
  });
  if (existing.payloadHash !== payloadHash) {
    logger.warn({ source, eventId }, "webhook redelivered with a different payload; treating as duplicate");
  }
  if (existing.status === "PROCESSED") {
    return "duplicate";
  }

  const reclaimable =
    existing.status === "FAILED" ||
    (existing.status === "PROCESSING" && Date.now() - existing.receivedAt.getTime() > STALE_PROCESSING_MS);
  if (!reclaimable) {
    return "in_progress";
  }
  // Guarded on the state we observed, so only one retry wins the reclaim.
  const reclaimed = await db.processedWebhook.updateMany({
    where: { id: existing.id, status: existing.status, receivedAt: existing.receivedAt },
    data: { status: "PROCESSING", receivedAt: new Date(), error: null },
  });
  return reclaimed.count === 1 ? "process" : "in_progress";
}

export async function markWebhookProcessed(source: WebhookSource, eventId: string): Promise<void> {
  await db.processedWebhook.update({
    where: { source_eventId: { source, eventId: eventId.slice(0, 255) } },
    data: { status: "PROCESSED", processedAt: new Date(), error: null },
  });
}

export async function markWebhookFailed(source: WebhookSource, eventId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.processedWebhook
    .update({
      where: { source_eventId: { source, eventId: eventId.slice(0, 255) } },
      data: { status: "FAILED", error: message.slice(0, 1000) },
    })
    .catch((updateError: unknown) => logger.error({ err: updateError }, "failed to mark webhook as failed"));
}
