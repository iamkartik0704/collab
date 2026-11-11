import type { Currency, PaymentMethodType, PaymentProvider } from "@prisma/client";

/** What the browser needs to complete payment with the selected provider. */
export type PaymentSession =
  | { provider: "STRIPE"; providerOrderId: string; clientSecret: string; publishableKey: string }
  | {
      provider: "RAZORPAY";
      providerOrderId: string;
      keyId: string;
      amountMinor: number;
      currency: Currency;
      orderNumber: string;
      prefill: { name: string | null; email: string | null; contact: string | null };
    };

export interface CreateSessionInput {
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: Currency;
  /** Stable per payment attempt; forwarded to the provider's idempotency mechanism. */
  idempotencyKey: string;
  method: PaymentMethodType | null;
  customer: { name: string | null; email: string | null; phone: string | null };
}

export interface RefundInput {
  providerOrderId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  idempotencyKey: string;
  reason: string;
  refundId: string;
}

export interface RefundOutcome {
  providerRefundId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createSession(input: CreateSessionInput): Promise<PaymentSession>;
  /** Best effort: stops a pending payment from being completed later. */
  cancelSession(providerOrderId: string): Promise<void>;
  refund(input: RefundInput): Promise<RefundOutcome>;
}
