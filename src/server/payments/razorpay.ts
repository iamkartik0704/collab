import type { PaymentMethodType } from "@prisma/client";
import Razorpay from "razorpay";
import { env } from "@/env";
import { hmacSha256Hex, safeEqual } from "@/lib/crypto";
import type { CreateSessionInput, PaymentGateway, PaymentSession, RefundInput, RefundOutcome } from "./gateway";

const globalForRazorpay = globalThis as unknown as { __collabRazorpay?: Razorpay };

function client(): Razorpay {
  globalForRazorpay.__collabRazorpay ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return globalForRazorpay.__collabRazorpay;
}

export function razorpayMethodToPaymentMethod(method: string | undefined): PaymentMethodType | null {
  switch (method) {
    case "card":
    case "emi":
      return "CARD";
    case "upi":
      return "UPI";
    case "netbanking":
      return "NETBANKING";
    case "wallet":
      return "WALLET";
    default:
      return null;
  }
}

export const razorpayGateway: PaymentGateway = {
  provider: "RAZORPAY",

  async createSession(input: CreateSessionInput): Promise<PaymentSession> {
    // Razorpay orders have no idempotency header; the caller only creates one per Payment row
    // and stores its id before returning it, so a retry reuses the stored order.
    const order = await client().orders.create({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.orderNumber,
      notes: { orderId: input.orderId, orderNumber: input.orderNumber, attempt: input.idempotencyKey.slice(0, 40) },
    });
    return {
      provider: "RAZORPAY",
      providerOrderId: order.id,
      keyId: env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      amountMinor: input.amountMinor,
      currency: input.currency,
      orderNumber: input.orderNumber,
      prefill: { name: input.customer.name, email: input.customer.email, contact: input.customer.phone },
    };
  },

  async cancelSession(): Promise<void> {
    // Razorpay orders cannot be cancelled via API; unpaid orders simply lapse. A late capture
    // is handled by the webhook (re-acquire stock or auto-refund).
  },

  async refund(input: RefundInput): Promise<RefundOutcome> {
    if (!input.providerPaymentId) {
      throw new Error("Razorpay refunds require the captured payment id");
    }
    const refund = await client().payments.refund(input.providerPaymentId, {
      amount: input.amountMinor,
      speed: "normal",
      receipt: input.refundId.slice(0, 40),
      notes: { refundId: input.refundId, reason: input.reason.slice(0, 250) },
    });
    return {
      providerRefundId: refund.id,
      status: refund.status === "processed" ? "SUCCEEDED" : refund.status === "failed" ? "FAILED" : "PENDING",
    };
  },
};

/**
 * Razorpay webhook signature: hex HMAC-SHA256 of the raw request body keyed with the webhook
 * secret, compared in constant time.
 */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = hmacSha256Hex(rawBody, env.RAZORPAY_WEBHOOK_SECRET);
  return safeEqual(expected, signature.trim().toLowerCase());
}
