import { z } from "zod";

/**
 * Admin portal input contracts, shared by the browser forms (react-hook-form) and the API
 * routes (authoritative validation). No server imports.
 */

// ============================================================================ enums (mirrors Prisma)

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "PAYMENT_FAILED",
  "RETURNED",
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const ADJUSTMENT_REASON_VALUES = [
  "PURCHASE_ORDER_RECEIVED",
  "CUSTOMER_RETURN_RESTOCK",
  "CYCLE_COUNT_CORRECTION",
  "DAMAGED",
  "LOST_OR_STOLEN",
  "RETURN_TO_VENDOR",
  "SYSTEM_CORRECTION",
] as const;

export const ADJUSTMENT_REASON_LABELS: Record<(typeof ADJUSTMENT_REASON_VALUES)[number], { label: string; direction: "in" | "out" | "any" }> = {
  PURCHASE_ORDER_RECEIVED: { label: "Purchase order received", direction: "in" },
  CUSTOMER_RETURN_RESTOCK: { label: "Customer return (sellable)", direction: "in" },
  CYCLE_COUNT_CORRECTION: { label: "Cycle count correction", direction: "any" },
  DAMAGED: { label: "Damaged", direction: "out" },
  LOST_OR_STOLEN: { label: "Lost or stolen", direction: "out" },
  RETURN_TO_VENDOR: { label: "Returned to vendor", direction: "out" },
  SYSTEM_CORRECTION: { label: "System correction", direction: "any" },
};

/** GST slabs offered in the product builder (basis points). */
export const GST_RATE_OPTIONS = [0, 500, 1200, 1800, 2800, 4000] as const;

export const HIGHLIGHT_ICONS = ["screen", "cpu", "cores", "camera", "front-camera", "battery", "storage", "weight", "display"] as const;

// ============================================================================ product builder

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

const minor = z.number().int().min(0).max(1_000_000_000);

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/;

export const variantInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(SKU_PATTERN, "SKU: 3-64 characters, A-Z, 0-9 and dashes"),
    barcode: z
      .string()
      .trim()
      .regex(/^\d{8,14}$/, "Barcode: 8-14 digits")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    color: optionalText(40),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be #RRGGBB")
      .nullable()
      .optional()
      .transform((value) => value?.toLowerCase() ?? null),
    storageGb: z.number().int().positive().max(65_536).nullable(),
    ramGb: z.number().int().positive().max(4_096).nullable(),
    priceMinor: minor,
    compareAtPriceMinor: minor.nullable(),
    costPriceMinor: minor.nullable(),
    weightGrams: z.number().int().positive().max(1_000_000).nullable(),
    isActive: z.boolean(),
    isDefault: z.boolean(),
    /** Opening stock for a new SKU (recorded as a RESTOCK movement). Ignored for existing SKUs. */
    initialStock: z.number().int().min(0).max(1_000_000).default(0),
    lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  })
  .refine((variant) => variant.compareAtPriceMinor === null || variant.compareAtPriceMinor >= variant.priceMinor, {
    message: "Compare-at price must be at least the selling price",
    path: ["compareAtPriceMinor"],
  });
export type VariantInput = z.input<typeof variantInputSchema>;

export const imageInputSchema = z.object({
  /** Object-storage key (new uploads) or an existing image's key. */
  storageKey: z.string().min(1).max(512),
  alt: z.string().trim().min(1, "Alt text is required").max(200),
  width: z.number().int().min(1).max(12_000),
  height: z.number().int().min(1).max(12_000),
  /** Shown when this colour is selected; null = shared by every variant. */
  color: z.string().trim().max(40).nullable(),
  isPrimary: z.boolean(),
});

export const highlightInputSchema = z.object({
  icon: z.enum(HIGHLIGHT_ICONS),
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(60),
});

export const productInputSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug: lowercase letters, digits and single dashes")
      .max(160),
    subtitle: optionalText(200),
    summary: optionalText(2000),
    description: z.string().trim().min(10, "Description is required").max(20_000),
    brandId: z.string().min(1, "Choose a brand"),
    categoryId: z.string().min(1, "Choose a category"),
    status: z.enum(PRODUCT_STATUSES),
    isFeatured: z.boolean(),
    warrantyMonths: z.number().int().min(0).max(120),
    /** GST overrides; null = the category's HSN code / rate. */
    hsnCode: z
      .string()
      .trim()
      .regex(/^\d{4}(\d{2}){0,2}$/, "HSN code: 4, 6 or 8 digits")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null))
      .transform((value) => value ?? null),
    gstRateBps: z.number().int().min(0).max(10_000).nullable().optional().transform((value) => value ?? null),
    metaTitle: optionalText(70),
    metaDescription: optionalText(170),
    specs: z.record(z.string().trim().min(1).max(60), z.record(z.string().trim().min(1).max(80), z.string().trim().max(300))),
    highlightSpecs: z.array(highlightInputSchema).max(6),
    variants: z.array(variantInputSchema).min(1, "Add at least one variant").max(120),
    images: z.array(imageInputSchema).max(40),
  })
  .superRefine((product, ctx) => {
    const skus = new Set<string>();
    const combos = new Set<string>();
    product.variants.forEach((variant, index) => {
      const sku = variant.sku.trim().toUpperCase();
      if (skus.has(sku)) ctx.addIssue({ code: "custom", message: `Duplicate SKU ${sku}`, path: ["variants", index, "sku"] });
      skus.add(sku);
      const combo = variantOptionKey(variant);
      if (combos.has(combo)) ctx.addIssue({ code: "custom", message: "Two variants have the same options", path: ["variants", index] });
      combos.add(combo);
    });
    const active = product.variants.filter((variant) => variant.isActive);
    if (product.status === "ACTIVE" && active.length === 0) {
      ctx.addIssue({ code: "custom", message: "An active product needs at least one active variant", path: ["variants"] });
    }
    const defaults = product.variants.filter((variant) => variant.isDefault);
    if (defaults.length !== 1 || !defaults[0]!.isActive) {
      ctx.addIssue({ code: "custom", message: "Mark exactly one active variant as the default", path: ["variants"] });
    }
    if (product.images.filter((image) => image.isPrimary).length > 1) {
      ctx.addIssue({ code: "custom", message: "Only one image can be the primary image", path: ["images"] });
    }
    const colors = new Set(product.variants.map((variant) => variant.color?.trim() || null));
    product.images.forEach((image, index) => {
      if (image.color && !colors.has(image.color)) {
        ctx.addIssue({ code: "custom", message: `No variant has the colour "${image.color}"`, path: ["images", index, "color"] });
      }
    });
  });
export type ProductInput = z.output<typeof productInputSchema>;
export type ProductFormValues = z.input<typeof productInputSchema>;

/** Identity of a variant's option combination ("Black|256|8"). */
export function variantOptionKey(variant: { color?: string | null; storageGb?: number | null; ramGb?: number | null }): string {
  return `${variant.color?.trim().toLowerCase() || "-"}|${variant.storageGb ?? "-"}|${variant.ramGb ?? "-"}`;
}

export const presignRequestSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  sizeBytes: z.number().int().min(1).max(8 * 1024 * 1024, "Images must be 8 MB or smaller"),
  /** Existing product id, or omitted while creating a product. */
  productId: z.string().min(1).max(64).optional(),
});

// ============================================================================ inventory

export const stockAdjustmentSchema = z
  .object({
    mode: z.enum(["delta", "set"]),
    quantity: z.number().int().min(-1_000_000).max(1_000_000),
    reason: z.enum(ADJUSTMENT_REASON_VALUES),
    note: optionalText(500),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode === "set" && input.quantity < 0) {
      ctx.addIssue({ code: "custom", message: "A physical count cannot be negative", path: ["quantity"] });
    }
    if (input.mode === "delta" && input.quantity === 0) {
      ctx.addIssue({ code: "custom", message: "Enter a non-zero quantity", path: ["quantity"] });
    }
    if ((input.reason === "SYSTEM_CORRECTION" || input.reason === "LOST_OR_STOLEN") && !input.note) {
      ctx.addIssue({ code: "custom", message: "Add a note explaining this adjustment", path: ["note"] });
    }
  });
export type StockAdjustmentRequest = z.input<typeof stockAdjustmentSchema>;

export const inventorySettingsSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(100_000),
});

// ============================================================================ orders

/** Fulfilment state machine: allowed admin transitions from each status. */
export const ORDER_TRANSITIONS: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  PENDING_PAYMENT: ["CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  CANCELLED: [],
  PAYMENT_FAILED: [],
  RETURNED: [],
};

/** Paid statuses before dispatch: cancelling them restocks and refunds. */
export const PRE_DISPATCH_STATUSES: readonly OrderStatusValue[] = ["PLACED", "CONFIRMED", "PACKED"];

export const trackingSchema = z.object({
  carrierName: z.string().trim().min(2, "Carrier is required").max(80),
  trackingNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,64}$/, "Tracking number: 4-64 letters, digits or dashes"),
  trackingUrl: z
    .url({ protocol: /^https$/, message: "Tracking link must be an https:// URL" })
    .max(500)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((value) => value ?? null),
});

/** 15-digit IMEI with a valid Luhn check digit. */
export function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 15; index++) {
    let digit = Number(value[14 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** A device identifier: an IMEI (15 digits, Luhn-checked) or a manufacturer serial number. */
export const deviceSerialSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => (/^\d{15}$/.test(value) ? isValidImei(value) : /^[A-Z0-9][A-Z0-9-]{3,39}$/.test(value)), {
    message: "Serial: 4-40 letters, digits or dashes; a 15-digit IMEI must have a valid check digit",
  });

export const itemSerialsSchema = z
  .array(z.object({ orderItemId: z.string().min(1), serialNumbers: z.array(deviceSerialSchema).max(100) }))
  .max(100)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) =>
      item.serialNumbers.forEach((serial, serialIndex) => {
        if (seen.has(serial)) ctx.addIssue({ code: "custom", message: `Serial ${serial} is entered twice`, path: [index, "serialNumbers", serialIndex] });
        seen.add(serial);
      }),
    );
  });

export const orderTransitionSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  note: optionalText(500),
  tracking: trackingSchema.optional(),
  /** RETURNED: put the units back into sellable stock. */
  restock: z.boolean().default(false),
  /** RETURNED: refund everything not yet refunded. (Cancelling a paid order always refunds.) */
  refundRemaining: z.boolean().default(false),
  /** PACKED / SHIPPED: device serial / IMEI numbers per order item (printed on the invoice). */
  serials: itemSerialsSchema.optional(),
});
export type OrderTransitionRequest = z.input<typeof orderTransitionSchema>;

export const refundRequestSchema = z
  .object({
    mode: z.enum(["items", "amount"]),
    items: z
      .array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(1).max(1000) }))
      .max(100)
      .default([]),
    amountMinor: z.number().int().min(1).max(1_000_000_000).optional(),
    restock: z.boolean().default(false),
    reason: z.string().trim().min(3, "Give a reason for the refund").max(500),
  })
  .superRefine((input, ctx) => {
    if (input.mode === "items" && input.items.length === 0) {
      ctx.addIssue({ code: "custom", message: "Choose at least one item to refund", path: ["items"] });
    }
    if (input.mode === "amount" && input.amountMinor === undefined) {
      ctx.addIssue({ code: "custom", message: "Enter the refund amount", path: ["amountMinor"] });
    }
    if (input.mode === "amount" && input.restock) {
      ctx.addIssue({ code: "custom", message: "Restocking needs an item refund", path: ["restock"] });
    }
  });
export type RefundRequest = z.input<typeof refundRequestSchema>;

// ============================================================================ coupons

export const couponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,40}$/, "Code: 3-40 characters, A-Z, 0-9, _ and -"),
    description: optionalText(200),
    discountType: z.enum(["PERCENTAGE", "FLAT"]),
    percentOffBps: z.number().int().min(1).max(10_000).nullable(),
    maxDiscountMinor: z.number().int().min(1).max(1_000_000_000).nullable(),
    amountOffMinor: z.number().int().min(1).max(1_000_000_000).nullable(),
    minCartValueMinor: z.number().int().min(0).max(1_000_000_000),
    usageLimitTotal: z.number().int().min(1).max(10_000_000).nullable(),
    usageLimitPerUser: z.number().int().min(1).max(1_000).nullable(),
    firstOrderOnly: z.boolean(),
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date().nullable(),
    isActive: z.boolean(),
    categoryIds: z.array(z.string().min(1)).max(50),
    brandIds: z.array(z.string().min(1)).max(100),
  })
  .superRefine((coupon, ctx) => {
    if (coupon.discountType === "PERCENTAGE" && coupon.percentOffBps === null) {
      ctx.addIssue({ code: "custom", message: "Enter the percentage", path: ["percentOffBps"] });
    }
    if (coupon.discountType === "FLAT" && coupon.amountOffMinor === null) {
      ctx.addIssue({ code: "custom", message: "Enter the amount off", path: ["amountOffMinor"] });
    }
    if (coupon.expiresAt && coupon.expiresAt <= coupon.startsAt) {
      ctx.addIssue({ code: "custom", message: "Expiry must be after the start", path: ["expiresAt"] });
    }
  })
  .transform((coupon) =>
    coupon.discountType === "PERCENTAGE"
      ? { ...coupon, amountOffMinor: null }
      : { ...coupon, percentOffBps: null, maxDiscountMinor: null },
  );
export type CouponInput = z.output<typeof couponInputSchema>;
export type CouponFormValues = z.input<typeof couponInputSchema>;
