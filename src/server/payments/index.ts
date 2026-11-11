import type { PaymentProvider } from "@prisma/client";
import type { PaymentGateway } from "./gateway";
import { razorpayGateway } from "./razorpay";
import { stripeGateway } from "./stripe";

const GATEWAYS: Record<PaymentProvider, PaymentGateway> = {
  STRIPE: stripeGateway,
  RAZORPAY: razorpayGateway,
};

export function getPaymentGateway(provider: PaymentProvider): PaymentGateway {
  return GATEWAYS[provider];
}

export type { PaymentGateway, PaymentSession } from "./gateway";
