import { z } from "zod";
import { isValidGstin, normalizeGstin } from "@/lib/gstin";

/** Delivery windows offered for Scheduled Delivery. */
export const DELIVERY_SLOTS = ["09:00-12:00", "12:00-15:00", "15:00-18:00", "18:00-21:00"] as const;
export type DeliverySlot = (typeof DELIVERY_SLOTS)[number];

/** POST /api/checkout body. Amounts are never accepted from the client. */
export const checkoutSchema = z
  .object({
    addressId: z.string().trim().min(10).max(40),
    shippingMethodCode: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    scheduledSlot: z.enum(DELIVERY_SLOTS).optional(),
    provider: z.enum(["STRIPE", "RAZORPAY"]),
    paymentMethod: z.enum(["CARD", "UPI", "NETBANKING", "WALLET"]).optional(),
    customerNote: z.string().trim().max(500).optional(),
    /** B2B buyers: GSTIN printed on the tax invoice for input tax credit. */
    customerGstin: z
      .string()
      .transform(normalizeGstin)
      .refine(isValidGstin, "Enter a valid 15-character GSTIN")
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.scheduledDate) === Boolean(value.scheduledSlot), {
    message: "scheduledDate and scheduledSlot must be provided together",
    path: ["scheduledSlot"],
  });

export type CheckoutBody = z.infer<typeof checkoutSchema>;
