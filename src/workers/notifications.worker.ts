import { UnrecoverableError, type Job, type Worker } from "bullmq";
import { env } from "@/env";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { notificationJobSchema, QueueName } from "@/queues";
import { PermanentEmailError, sendEmail } from "@/services/email.service";
import { PermanentWhatsAppError, sendWhatsAppTemplate } from "@/services/whatsapp.service";
import { renderNotification } from "@/server/notifications/render";
import { startWorker } from "./runtime";

/**
 * Delivers queued notifications (email + WhatsApp).
 *
 * Delivery is at-least-once. The NotificationLog row is the source of truth and is claimed
 * (QUEUED/FAILED -> SENDING) *before* the provider call, because a row marked SENT only afterwards
 * cannot distinguish "never sent" from "sent but the process died before recording it". Email also
 * carries a provider idempotency key; WhatsApp has no such mechanism, so an attempt whose outcome is
 * unknown is escalated to a human instead of being retried.
 */

const log = childLogger({ worker: QueueName.notifications });
const DONE = new Set(["SENT", "DELIVERED", "READ"]);

/**
 * How long a SENDING row counts as in flight. BullMQ retries run seconds apart, so a retry inside
 * this window means the previous attempt may already have been accepted by the provider. Past the
 * lease we assume the process died mid-call and allow one resend (a late duplicate beats a lost
 * message).
 */
const SENDING_LEASE_MS = 15 * 60_000;

/** Failures where the provider may or may not have accepted the message. */
function isAmbiguousDeliveryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["TimeoutError", "AbortError", "APIConnectionError", "APIConnectionTimeoutError"].includes(error.name)) return true;
  return /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(error.message);
}

async function alertAmbiguous(entryId: string, updatedAt: Date, type: string, channel: string): Promise<void> {
  await db.adminAlert
    .createMany({
      data: [
        {
          type: "NOTIFICATION_DEAD_LETTER",
          severity: "WARNING",
          title: `Delivery outcome unknown: ${type} (${channel})`,
          message: `NotificationLog ${entryId} has been SENDING since ${updatedAt.toISOString()}. Check the provider dashboard before resending: sending again risks a duplicate.`,
          entityType: "NotificationLog",
          entityId: entryId,
          dedupeKey: `ambiguous-delivery:${entryId}`,
        },
      ],
      skipDuplicates: true,
    })
    .catch((error: unknown) => log.error({ err: error, notificationLogId: entryId }, "ambiguous-delivery alert not recorded"));
}

async function deliver(job: Job): Promise<string> {
  const data = notificationJobSchema.parse(job.data);
  const entry = await db.notificationLog.findUnique({ where: { id: data.notificationLogId } });
  if (!entry) return "missing-log";
  if (DONE.has(entry.status)) return "already-sent";
  if (entry.status === "DEAD_LETTERED") return "dead-lettered";

  // A login code that arrives after it expired is worse than none.
  if (data.type === "OTP" && Date.now() - entry.createdAt.getTime() > (env.OTP_TTL_SECONDS ?? 300) * 1000) {
    await db.notificationLog.update({ where: { id: entry.id }, data: { status: "FAILED", failedAt: new Date(), lastError: "expired before delivery" } });
    return "otp-expired";
  }

  // Claimed and still inside the lease: an earlier attempt reached the provider and we never saw the
  // result. Re-sending would duplicate the message, so stop and let a human check the dashboard.
  if (entry.status === "SENDING" && Date.now() - entry.updatedAt.getTime() < SENDING_LEASE_MS) {
    await alertAmbiguous(entry.id, entry.updatedAt, data.type, data.channel);
    return "outcome-unknown";
  }

  // Optimistic claim (status + updatedAt) so two workers can never both send for one log row.
  const claim = await db.notificationLog.updateMany({
    where: { id: entry.id, status: entry.status, updatedAt: entry.updatedAt },
    data: { status: "SENDING", jobId: String(job.id).slice(0, 128), attempts: { increment: 1 } },
  });
  if (claim.count !== 1) return "claim-lost";

  const rendered = await renderNotification({ type: data.type, channel: data.channel, orderId: entry.orderId, templateData: data.templateData });
  try {
    const result =
      rendered.channel === "EMAIL"
        ? await sendEmail({
            to: data.recipient,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            attachments: rendered.attachments,
            idempotencyKey: `notification-${entry.id}`,
            tags: { type: data.type },
          })
        : await sendWhatsAppTemplate(data.recipient, rendered.template);
    await db.notificationLog.update({
      where: { id: entry.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId.slice(0, 255), templateName: rendered.templateName, lastError: null },
    });
    return `sent:${rendered.channel}`;
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    if (error instanceof PermanentEmailError || error instanceof PermanentWhatsAppError) {
      // Retrying cannot help (invalid number, template rejected, bad address).
      await db.notificationLog.update({ where: { id: entry.id }, data: { status: "FAILED", failedAt: new Date(), lastError: message } });
      throw new UnrecoverableError(message);
    }
    if (isAmbiguousDeliveryError(error)) {
      // Deliberately leave the row SENDING: the retry must report "outcome-unknown", not send again.
      await db.notificationLog.update({ where: { id: entry.id }, data: { lastError: `ambiguous: ${message}` } }).catch(() => undefined);
      throw error;
    }
    // The provider answered with a definite rejection (5xx/429): it did not accept the message, so
    // the retry is safe.
    await db.notificationLog.update({ where: { id: entry.id }, data: { status: "FAILED", lastError: message } }).catch(() => undefined);
    throw error;
  }
}

async function onDeadLetter(job: Job, error: Error): Promise<void> {
  const parsed = notificationJobSchema.safeParse(job.data);
  if (!parsed.success) return;
  await db.notificationLog.updateMany({
    where: { id: parsed.data.notificationLogId, status: { in: ["QUEUED", "FAILED", "SENDING"] } },
    data: { status: "DEAD_LETTERED", failedAt: new Date(), lastError: error.message.slice(0, 1000) },
  });
  log.error({ notificationLogId: parsed.data.notificationLogId, type: parsed.data.type, channel: parsed.data.channel }, "notification dead-lettered");
}

export function startNotificationsWorker(): Worker {
  return startWorker({ queue: QueueName.notifications, processor: deliver, alertType: "NOTIFICATION_DEAD_LETTER", onDeadLetter });
}
