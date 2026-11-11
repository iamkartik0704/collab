import type { NotificationStatus } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { safeEqual, sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { verifyWhatsAppSignature } from "@/services/whatsapp.service";
import { processVerifiedWebhook, readRawBody, rejectWebhook } from "@/server/webhooks/process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * WhatsApp Business Cloud API webhook.
 *  GET  - Meta's subscription handshake (hub.verify_token must equal WHATSAPP_WEBHOOK_VERIFY_TOKEN).
 *  POST - X-Hub-Signature-256 verified: message status receipts (sent -> delivered -> read /
 *         failed) update NotificationLog; an inbound "STOP" opts the customer out of WhatsApp.
 */

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") === "subscribe" && safeEqual(token, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return rejectWebhook(403, "verification_failed");
}

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]).or(z.string()),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() })).optional(),
});

const messageSchema = z.object({
  from: z.string(),
  id: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string().optional(), payload: z.string().optional() }).optional(),
});

const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({ statuses: z.array(statusSchema).optional(), messages: z.array(messageSchema).optional() }).passthrough(),
        }),
      ),
    }),
  ),
});

const STATUS_ORDER: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const OPT_OUT = /^\s*(stop|unsubscribe|opt[\s-]?out)\s*$/i;

async function dispatch(payload: z.infer<typeof payloadSchema>): Promise<string> {
  let statuses = 0;
  let optOuts = 0;
  for (const change of payload.entry.flatMap((entry) => entry.changes)) {
    if (change.field !== "messages") continue;
    for (const status of change.value.statuses ?? []) {
      const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();
      const log = await db.notificationLog.findFirst({ where: { channel: "WHATSAPP", providerMessageId: status.id }, select: { id: true, status: true } });
      if (!log) continue;
      if (status.status === "failed") {
        const error = status.errors?.[0];
        await db.notificationLog.update({ where: { id: log.id }, data: { status: "FAILED", failedAt: at, lastError: `${error?.code ?? ""} ${error?.title ?? error?.message ?? "delivery failed"}`.trim().slice(0, 1000) } });
      } else {
        const next = status.status.toUpperCase() as NotificationStatus;
        // Receipts can arrive out of order; never move a message backwards.
        if ((STATUS_ORDER[next] ?? -1) <= (STATUS_ORDER[log.status] ?? -1)) continue;
        await db.notificationLog.update({
          where: { id: log.id },
          data: { status: next, ...(next === "DELIVERED" ? { deliveredAt: at } : {}), ...(next === "READ" ? { readAt: at } : {}) },
        });
      }
      statuses++;
    }
    for (const message of change.value.messages ?? []) {
      const text = message.text?.body ?? message.button?.text ?? message.button?.payload ?? "";
      if (!OPT_OUT.test(text)) continue;
      const phone = `+${message.from.replace(/\D/g, "")}`;
      const user = await db.user.findUnique({ where: { phone }, select: { id: true } });
      if (!user) continue;
      await db.notificationPreference.upsert({
        where: { userId: user.id },
        create: { userId: user.id, whatsappOptIn: false, whatsappOptOutAt: new Date() },
        update: { whatsappOptIn: false, whatsappMarketing: false, whatsappOptOutAt: new Date() },
      });
      optOuts++;
    }
  }
  return `statuses:${statuses} optouts:${optOuts}`;
}

export async function POST(request: NextRequest) {
  const rawBody = await readRawBody(request);
  if (rawBody === null) return rejectWebhook(413, "payload_too_large");
  if (!verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    logger.warn("rejected whatsapp webhook with invalid signature");
    return rejectWebhook(401, "invalid_signature");
  }
  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(rawBody));
  } catch (error) {
    logger.warn({ err: error }, "unparseable whatsapp webhook");
    // 200: Meta disables webhooks that keep failing, and a malformed body will not improve.
    return NextResponse.json({ received: true, ignored: true });
  }
  // Meta sends no event id; the body hash identifies a redelivery.
  return processVerifiedWebhook("WHATSAPP", { id: sha256Hex(rawBody), type: "messages" }, rawBody, () => dispatch(payload));
}
