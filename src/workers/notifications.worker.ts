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
 * Delivers queued notifications (email + WhatsApp). Exactly-once from the customer's point of
 * view: the NotificationLog row is the source of truth, a job whose log is already SENT is a
 * no-op, and providers receive the log id as their idempotency key where supported.
 */

const log = childLogger({ worker: QueueName.notifications });
const DONE = new Set(["SENT", "DELIVERED", "READ"]);

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

  await db.notificationLog.update({ where: { id: entry.id }, data: { attempts: { increment: 1 }, jobId: String(job.id).slice(0, 128) } });

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
    await db.notificationLog.update({ where: { id: entry.id }, data: { lastError: message } }).catch(() => undefined);
    if (error instanceof PermanentEmailError || error instanceof PermanentWhatsAppError) {
      // Retrying cannot help (invalid number, template rejected, bad address).
      throw new UnrecoverableError(message);
    }
    throw error;
  }
}

async function onDeadLetter(job: Job, error: Error): Promise<void> {
  const parsed = notificationJobSchema.safeParse(job.data);
  if (!parsed.success) return;
  await db.notificationLog.updateMany({
    where: { id: parsed.data.notificationLogId, status: { in: ["QUEUED", "FAILED"] } },
    data: { status: "DEAD_LETTERED", failedAt: new Date(), lastError: error.message.slice(0, 1000) },
  });
  log.error({ notificationLogId: parsed.data.notificationLogId, type: parsed.data.type, channel: parsed.data.channel }, "notification dead-lettered");
}

export function startNotificationsWorker(): Worker {
  return startWorker({ queue: QueueName.notifications, processor: deliver, alertType: "NOTIFICATION_DEAD_LETTER", onDeadLetter });
}
