import { z } from "zod";

/** Shared by the cart UI forms and the cart Route Handlers. No price fields, by design. */

export const MAX_QUANTITY_PER_LINE = 10;
export const MAX_CART_LINES = 50;

export const variantIdSchema = z.string().trim().min(10).max(40).regex(/^[a-z0-9]+$/, "Invalid variant id");

export const addCartItemSchema = z.object({
  variantId: variantIdSchema,
  quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_LINE).default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(MAX_QUANTITY_PER_LINE),
});

export const applyCouponSchema = z.object({
  code: z.string().trim().min(3).max(40),
});
