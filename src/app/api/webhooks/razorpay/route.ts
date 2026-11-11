import type { NextRequest } from "next/server";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { handlePaymentFailed, handlePaymentSucceeded, handleRefundUpdated } from "@/server/payments/payment-events.service";
import { razorpayMethodToPaymentMethod, verifyRazorpayWebhookSignature } from "@/server/payments/razorpay";
import { processVerifiedWebhook, readRawBody, rejectWebhook } from "@/server/webhooks/process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notesSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional();

const paymentEntity = z.object({
  id: z.string(),
  order_id: z.string().nullable().optional(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  method: z.string().optional(),
  notes: notesSchema,
  error_code: z.string().nullable().optional(),
  error_description: z.string().nullable().optional(),
});

const refundEntity = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: z.number().int(),
  status: z.string(),
  notes: notesSchema,
});

const eventSchema = z.object({
  event: z.string(),
  created_at: z.number().int().optional(),
  payload: z.object({
    payment: z.object({ entity: paymentEntity }).optional(),
    refund: z.object({ entity: refundEntity }).optional(),
    order: z.object({ entity: z.object({ id: z.string(), notes: notesSchema }) }).optional(),
  }),
});
type RazorpayEvent = z.infer<typeof eventSchema>;

function note(notes: z.infer<typeof notesSchema>, key: string): string | null {
  if (!notes || Array.isArray(notes)) return null;
  const value = notes[key];
  return typeof value === "string" ? value : null;
}

async function dispatch(event: RazorpayEvent): Promise<string> {
  const payment = event.payload.payment?.entity;
  const order = event.payload.order?.entity;

  switch (event.event) {
    case "payment.captured":
    case "order.paid": {
      const providerOrderId = payment?.order_id ?? order?.id;
      if (!payment || !providerOrderId) return "ignored";
      return handlePaymentSucceeded({
        provider: "RAZORPAY",
        providerOrderId,
        providerPaymentId: payment.id,
        orderIdHint: note(order?.notes, "orderId") ?? note(payment.notes, "orderId"),
        amountMinor: payment.amount,
        currency: payment.currency,
        method: razorpayMethodToPaymentMethod(payment.method),
      });
    }
    case "payment.failed": {
      if (!payment?.order_id) return "ignored";
      return handlePaymentFailed({
        provider: "RAZORPAY",
        providerOrderId: payment.order_id,
        orderIdHint: note(payment.notes, "orderId"),
        failureCode: payment.error_code ?? null,
        failureMessage: payment.error_description ?? null,
        // The customer can retry on the same Razorpay order until the window expires.
        terminal: false,
      });
    }
    case "refund.processed":
    case "refund.failed": {
      const refund = event.payload.refund?.entity;
      if (!refund) return "ignored";
      return handleRefundUpdated({
        provider: "RAZORPAY",
        providerRefundId: refund.id,
        refundIdHint: note(refund.notes, "refundId"),
        status: event.event === "refund.processed" ? "SUCCEEDED" : "FAILED",
      });
    }
    default:
      return "ignored";
  }
}

/** POST /api/webhooks/razorpay - HMAC-SHA256 verified (X-Razorpay-Signature), replay-protected. */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    return rejectWebhook(400, "missing_signature");
  }
  const rawBody = await readRawBody(request);
  if (rawBody === null) {
    return rejectWebhook(413, "payload_too_large");
  }
  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    logger.warn("rejected razorpay webhook with invalid signature");
    return rejectWebhook(400, "invalid_signature");
  }

  let event: RazorpayEvent;
  try {
    event = eventSchema.parse(JSON.parse(rawBody));
  } catch (error) {
    logger.warn({ err: error }, "unparseable razorpay webhook");
    return rejectWebhook(400, "invalid_payload");
  }

  // Razorpay's per-event id header is the dedupe key; the body hash is a fallback.
  const eventId = request.headers.get("x-razorpay-event-id") ?? `body-${sha256Hex(rawBody)}`;
  return processVerifiedWebhook("RAZORPAY", { id: eventId, type: event.event }, rawBody, () => dispatch(event));
}
