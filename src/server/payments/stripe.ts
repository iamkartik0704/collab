import type { PaymentMethodType } from "@prisma/client";
import Stripe from "stripe";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import type { CreateSessionInput, PaymentGateway, PaymentSession, RefundInput, RefundOutcome } from "./gateway";

const globalForStripe = globalThis as unknown as { __collabStripe?: Stripe };

function client(): Stripe {
  globalForStripe.__collabStripe ??= new Stripe(env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "Collab" },
  });
  return globalForStripe.__collabStripe;
}

const METHOD_TYPES: Record<PaymentMethodType, string> = {
  CARD: "card",
  UPI: "upi",
  NETBANKING: "netbanking",
  WALLET: "card",
};

export function stripeMethodToPaymentMethod(type: string | undefined): PaymentMethodType | null {
  switch (type) {
    case "card":
      return "CARD";
    case "upi":
      return "UPI";
    case "netbanking":
      return "NETBANKING";
    case "link":
    case "paypal":
    case "amazon_pay":
      return "WALLET";
    default:
      return null;
  }
}

export const stripeGateway: PaymentGateway = {
  provider: "STRIPE",

  async createSession(input: CreateSessionInput): Promise<PaymentSession> {
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      description: `Collab order ${input.orderNumber}`,
      metadata: { orderId: input.orderId, orderNumber: input.orderNumber },
      ...(input.customer.email ? { receipt_email: input.customer.email } : {}),
      ...(input.method
        ? { payment_method_types: [METHOD_TYPES[input.method]] }
        : { automatic_payment_methods: { enabled: true } }),
    };
    const intent = await client().paymentIntents.create(params, { idempotencyKey: `pi-${input.idempotencyKey}` });
    if (!intent.client_secret) {
      throw new Error("Stripe returned a PaymentIntent without a client secret");
    }
    return {
      provider: "STRIPE",
      providerOrderId: intent.id,
      clientSecret: intent.client_secret,
      publishableKey: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    };
  },

  async cancelSession(providerOrderId: string): Promise<void> {
    try {
      await client().paymentIntents.cancel(providerOrderId, { cancellation_reason: "abandoned" });
    } catch (error) {
      // Already succeeded / cancelled: the webhook path decides what happens next.
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        logger.info({ providerOrderId, code: error.code }, "stripe PaymentIntent not cancellable");
        return;
      }
      throw error;
    }
  },

  async refund(input: RefundInput): Promise<RefundOutcome> {
    const refund = await client().refunds.create(
      {
        payment_intent: input.providerOrderId,
        amount: input.amountMinor,
        reason: "requested_by_customer",
        metadata: { refundId: input.refundId, reason: input.reason.slice(0, 450) },
      },
      { idempotencyKey: `refund-${input.idempotencyKey}` },
    );
    return {
      providerRefundId: refund.id,
      status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" || refund.status === "canceled" ? "FAILED" : "PENDING",
    };
  },
};

/**
 * Verifies the Stripe-Signature header (HMAC-SHA256 over `timestamp.rawBody`, 5-minute
 * timestamp tolerance against replays) and returns the parsed event. Throws on failure.
 */
export function verifyStripeWebhook(rawBody: string, signatureHeader: string): Stripe.Event {
  return client().webhooks.constructEvent(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
}
