import type { NotificationChannel, NotificationType, Prisma } from "@prisma/client";
import { env } from "@/env";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueNotificationJob } from "@/queues";

/**
 * Notification producer. Every message gets a NotificationLog row (the audit trail the worker
 * updates through sent -> delivered -> read) before its delivery job is queued. Secrets in the
 * template data (OTP codes) are redacted in the log but present in the short-lived job.
 */

export interface NotificationRequest {
  type: NotificationType;
  channel: NotificationChannel;
  recipient: string;
  userId?: string | null;
  orderId?: string | null;
  templateData: Record<string, string | number>;
  /** Keys of `templateData` that must not be persisted in NotificationLog. */
  redactKeys?: readonly string[];
}

export async function queueNotification(request: NotificationRequest): Promise<string> {
  const redacted: Prisma.InputJsonObject = Object.fromEntries(
    Object.entries(request.templateData).map(([key, value]) => [
      key,
      request.redactKeys?.includes(key) ? "[REDACTED]" : value,
    ]),
  );

  const log = await db.notificationLog.create({
    data: {
      type: request.type,
      channel: request.channel,
      recipient: request.recipient,
      userId: request.userId ?? null,
      orderId: request.orderId ?? null,
      payload: redacted,
      status: "QUEUED",
    },
    select: { id: true },
  });

  try {
    await enqueueNotificationJob({
      notificationLogId: log.id,
      type: request.type,
      channel: request.channel,
      recipient: request.recipient,
      templateData: request.templateData,
    });
  } catch (error) {
    await db.notificationLog.update({
      where: { id: log.id },
      data: { status: "FAILED", failedAt: new Date(), lastError: "enqueue failed: queue unavailable" },
    });
    throw error;
  }
  return log.id;
}

export interface LowStockItem {
  variantId: string;
  sku: string;
  productName: string;
  available: number;
  threshold: number;
}

/** Fans a low-stock alert out to every configured admin email and WhatsApp number. */
export async function notifyLowStock(item: LowStockItem): Promise<void> {
  const templateData = {
    sku: item.sku,
    productName: item.productName,
    available: item.available,
    threshold: item.threshold,
  };
  const recipients: Array<{ channel: NotificationChannel; recipient: string }> = [
    ...(env.ADMIN_ALERT_EMAILS ?? []).map((recipient) => ({ channel: "EMAIL" as const, recipient })),
    ...(env.ADMIN_ALERT_WHATSAPP_NUMBERS ?? []).map((recipient) => ({ channel: "WHATSAPP" as const, recipient })),
  ];
  const results = await Promise.allSettled(
    recipients.map(({ channel, recipient }) => queueNotification({ type: "LOW_STOCK_ALERT", channel, recipient, templateData })),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error({ err: result.reason, sku: item.sku }, "failed to queue low-stock alert");
    }
  }
}

/**
 * Customer-facing order update on every channel the customer allows: email (order updates on
 * by default) and WhatsApp (explicit opt-in required by WhatsApp Business policy).
 */
export async function queueOrderNotification(input: {
  orderId: string;
  type: Extract<NotificationType, "ORDER_CONFIRMATION" | "ORDER_SHIPPED" | "OUT_FOR_DELIVERY" | "ORDER_DELIVERED" | "REFUND_ISSUED">;
  templateData?: Record<string, string | number>;
}): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      totalMinor: true,
      currency: true,
      carrierName: true,
      trackingNumber: true,
      trackingUrl: true,
      user: {
        select: {
          name: true,
          email: true,
          phone: true,
          notificationPreference: { select: { whatsappOptIn: true, emailOrderUpdates: true } },
        },
      },
    },
  });
  if (!order) return;
  const templateData: Record<string, string | number> = {
    orderNumber: order.orderNumber,
    customerName: order.user.name ?? "there",
    totalMinor: order.totalMinor,
    currency: order.currency,
    ...(order.carrierName ? { carrierName: order.carrierName } : {}),
    ...(order.trackingNumber ? { trackingNumber: order.trackingNumber } : {}),
    ...(order.trackingUrl ? { trackingUrl: order.trackingUrl } : {}),
    ...input.templateData,
  };
  const deliveries: Array<Promise<string>> = [];
  if (order.user.email && (order.user.notificationPreference?.emailOrderUpdates ?? true)) {
    deliveries.push(queueNotification({ type: input.type, channel: "EMAIL", recipient: order.user.email, userId: order.userId, orderId: order.id, templateData }));
  }
  if (order.user.phone && order.user.notificationPreference?.whatsappOptIn) {
    deliveries.push(queueNotification({ type: input.type, channel: "WHATSAPP", recipient: order.user.phone, userId: order.userId, orderId: order.id, templateData }));
  }
  const results = await Promise.allSettled(deliveries);
  for (const result of results) {
    if (result.status === "rejected") logger.error({ err: result.reason, orderId: order.id, type: input.type }, "failed to queue order notification");
  }
}
