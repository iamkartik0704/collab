"use client";

/** Minimal typing of Razorpay Checkout (checkout.js). */
export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  method?: { card?: boolean; upi?: boolean; netbanking?: boolean; wallet?: boolean };
  theme?: { color?: string };
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void; escape?: boolean };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", handler: (response: { error: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;

/**
 * Injects checkout.js on demand. It is created by our own (nonce-trusted) bundle, which the
 * CSP's 'strict-dynamic' allows; checkout.razorpay.com is also explicitly allow-listed.
 */
export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load Razorpay. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openRazorpay(options: RazorpayOptions, onFailed: (message: string) => void): Promise<void> {
  await loadRazorpay();
  if (!window.Razorpay) throw new Error("Razorpay is unavailable.");
  const instance = new window.Razorpay(options);
  instance.on("payment.failed", (response) => onFailed(response.error.description ?? "Payment failed. Please try again."));
  instance.open();
}
