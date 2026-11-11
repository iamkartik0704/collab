import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { handlePaymentFailed, handlePaymentSucceeded, handleRefundUpdated } from "@/server/payments/payment-events.service";
import { stripeMethodToPaymentMethod, verifyStripeWebhook } from "@/server/payments/stripe";
import { processVerifiedWebhook, readRawBody, rejectWebhook } from "@/server/webhooks/process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function chargeId(intent: Stripe.PaymentIntent): string | null {
  const latest = intent.latest_charge;
  if (!latest) return null;
  return typeof latest === "string" ? latest : latest.id;
}

async function dispatch(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      return handlePaymentSucceeded({
        provider: "STRIPE",
        providerOrderId: intent.id,
        providerPaymentId: chargeId(intent),
        orderIdHint: intent.metadata?.orderId ?? null,
        amountMinor: intent.amount_received,
        currency: intent.currency,
        method: stripeMethodToPaymentMethod(intent.payment_method_types[0]),
      });
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const intent = event.data.object;
      return handlePaymentFailed({
        provider: "STRIPE",
        providerOrderId: intent.id,
        orderIdHint: intent.metadata?.orderId ?? null,
        failureCode: intent.last_payment_error?.code ?? intent.cancellation_reason ?? null,
        failureMessage: intent.last_payment_error?.message ?? null,
        terminal: event.type === "payment_intent.canceled",
      });
    }
    case "refund.created":
    case "refund.updated": {
      const refund = event.data.object;
      return handleRefundUpdated({
        provider: "STRIPE",
        providerRefundId: refund.id,
        refundIdHint: refund.metadata?.refundId ?? null,
        status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" || refund.status === "canceled" ? "FAILED" : "PENDING",
      });
    }
    default:
      return "ignored";
  }
}

/** POST /api/webhooks/stripe - HMAC-verified (Stripe-Signature), replay-protected. */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return rejectWebhook(400, "missing_signature");
  }
  const rawBody = await readRawBody(request);
  if (rawBody === null) {
    return rejectWebhook(413, "payload_too_large");
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(rawBody, signature);
  } catch (error) {
    logger.warn({ err: error }, "rejected stripe webhook with invalid signature");
    return rejectWebhook(400, "invalid_signature");
  }

  return processVerifiedWebhook("STRIPE", { id: event.id, type: event.type }, rawBody, () => dispatch(event));
}
