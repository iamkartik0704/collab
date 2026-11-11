import type { Currency } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { db, type TransactionClient } from "@/lib/db";
import { resolveImageUrl } from "@/lib/images";
import { includedTax } from "@/lib/money";
import { evaluateCoupon, type CouponRejection } from "@/server/coupons/coupon.service";

/**
 * The only place prices are computed. Inputs are variant ids + quantities (+ coupon code and
 * shipping method code); every amount comes from PostgreSQL. Prices are GST-inclusive: the
 * tax line is the GST contained in each line's discounted amount.
 */

export interface CartLineInput {
  variantId: string;
  quantity: number;
}

export type LineIssue = "unavailable" | "insufficient_stock";

export interface PricedLine {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantTitle: string;
  sku: string;
  imageKey: string | null;
  imageUrl: string | null;
  color: string | null;
  categoryId: string;
  brandId: string;
  hsnCode: string | null;
  quantity: number;
  available: number;
  unitPriceMinor: number;
  compareAtPriceMinor: number | null;
  lineSubtotalMinor: number;
  discountMinor: number;
  taxRateBps: number;
  taxMinor: number;
  lineTotalMinor: number;
  issue: LineIssue | null;
}

export interface PricedShipping {
  id: string;
  code: string;
  name: string;
  priceMinor: number;
  chargedMinor: number;
  minDays: number;
  maxDays: number;
  requiresSlot: boolean;
}

export interface PricedCart {
  currency: Currency;
  lines: PricedLine[];
  itemCount: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  coupon:
    | { code: string; applied: true; couponId: string; discountMinor: number; description: string | null; usageLimitPerUser: number | null }
    | { code: string; applied: false; reason: CouponRejection; message: string }
    | null;
  shipping: PricedShipping | null;
  /** False when any line is unavailable / short on stock or the cart is empty. */
  isCheckoutReady: boolean;
}

export async function priceCart(input: {
  lines: readonly CartLineInput[];
  couponCode?: string | null;
  userId?: string | null;
  shippingMethodCode?: string | null;
  client?: TransactionClient;
}): Promise<PricedCart> {
  const client = input.client ?? db;
  const variantIds = [...new Set(input.lines.map((line) => line.variantId))];

  const variants = variantIds.length
    ? await client.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          sku: true,
          title: true,
          priceMinor: true,
          compareAtPriceMinor: true,
          currency: true,
          color: true,
          isActive: true,
          deletedAt: true,
          inventory: { select: { quantityAvailable: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { storageKey: true } },
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              status: true,
              deletedAt: true,
              brandId: true,
              categoryId: true,
              hsnCode: true,
              gstRateBps: true,
              category: { select: { taxRateBps: true, hsnCode: true } },
              images: { where: { isPrimary: true }, take: 1, select: { storageKey: true } },
            },
          },
        },
      })
    : [];
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const currencies = new Set(variants.map((variant) => variant.currency));
  if (currencies.size > 1) {
    throw Errors.unprocessable("mixed_currency", "Items in different currencies cannot be bought together.");
  }
  const currency: Currency = variants[0]?.currency ?? "INR";

  const lines: PricedLine[] = [];
  for (const item of input.lines) {
    const variant = byId.get(item.variantId);
    if (!variant) continue; // Deleted variant: silently dropped from the priced view.
    const purchasable =
      variant.isActive && !variant.deletedAt && variant.product.status === "ACTIVE" && !variant.product.deletedAt;
    const available = variant.inventory?.quantityAvailable ?? 0;
    const lineSubtotal = variant.priceMinor * item.quantity;
    const imageKey = variant.images[0]?.storageKey ?? variant.product.images[0]?.storageKey ?? null;
    lines.push({
      variantId: variant.id,
      productId: variant.product.id,
      productSlug: variant.product.slug,
      productName: variant.product.name,
      variantTitle: variant.title,
      sku: variant.sku,
      imageKey,
      imageUrl: resolveImageUrl(imageKey),
      color: variant.color,
      categoryId: variant.product.categoryId,
      brandId: variant.product.brandId,
      // GST: the product's own HSN / rate when set, otherwise the category's (default 18%).
      hsnCode: variant.product.hsnCode ?? variant.product.category.hsnCode,
      quantity: item.quantity,
      available,
      unitPriceMinor: variant.priceMinor,
      compareAtPriceMinor: variant.compareAtPriceMinor,
      lineSubtotalMinor: purchasable ? lineSubtotal : 0,
      discountMinor: 0,
      taxRateBps: variant.product.gstRateBps ?? variant.product.category.taxRateBps,
      taxMinor: 0,
      lineTotalMinor: 0,
      issue: !purchasable ? "unavailable" : item.quantity > available ? "insufficient_stock" : null,
    });
  }

  const payable = lines.filter((line) => line.issue !== "unavailable");
  const subtotalMinor = payable.reduce((sum, line) => sum + line.lineSubtotalMinor, 0);

  // Coupon
  let coupon: PricedCart["coupon"] = null;
  if (input.couponCode) {
    const evaluation = await evaluateCoupon(client, {
      code: input.couponCode,
      userId: input.userId ?? null,
      lines: payable.map((line) => ({
        variantId: line.variantId,
        categoryId: line.categoryId,
        brandId: line.brandId,
        lineSubtotalMinor: line.lineSubtotalMinor,
      })),
    });
    if (evaluation.ok) {
      for (const line of payable) {
        line.discountMinor = evaluation.perLineDiscount.get(line.variantId) ?? 0;
      }
      coupon = {
        code: evaluation.code,
        applied: true,
        couponId: evaluation.couponId,
        discountMinor: evaluation.discountMinor,
        description: evaluation.description,
        usageLimitPerUser: evaluation.usageLimitPerUser,
      };
    } else {
      coupon = { code: input.couponCode.trim().toUpperCase(), applied: false, reason: evaluation.code, message: evaluation.message };
    }
  }

  for (const line of payable) {
    const net = line.lineSubtotalMinor - line.discountMinor;
    line.taxMinor = includedTax(net, line.taxRateBps);
    line.lineTotalMinor = net;
  }
  const discountMinor = payable.reduce((sum, line) => sum + line.discountMinor, 0);
  const taxMinor = payable.reduce((sum, line) => sum + line.taxMinor, 0);

  // Shipping: the requested method, or the default (first active) as an estimate.
  const method = input.shippingMethodCode
    ? await client.shippingMethod.findFirst({ where: { code: input.shippingMethodCode, isActive: true } })
    : await client.shippingMethod.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { priceMinor: "asc" }] });
  if (input.shippingMethodCode && !method) {
    throw Errors.unprocessable("invalid_shipping_method", "That delivery option is not available.");
  }
  const goodsAfterDiscount = subtotalMinor - discountMinor;
  const shipping: PricedShipping | null = method
    ? {
        id: method.id,
        code: method.code,
        name: method.name,
        priceMinor: method.priceMinor,
        chargedMinor:
          payable.length === 0 || (method.freeAboveMinor !== null && goodsAfterDiscount >= method.freeAboveMinor)
            ? 0
            : method.priceMinor,
        minDays: method.minDays,
        maxDays: method.maxDays,
        requiresSlot: method.requiresSlot,
      }
    : null;
  const shippingMinor = shipping?.chargedMinor ?? 0;

  return {
    currency,
    lines,
    itemCount: payable.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor,
    discountMinor,
    taxMinor,
    shippingMinor,
    totalMinor: goodsAfterDiscount + shippingMinor,
    coupon,
    shipping,
    isCheckoutReady: lines.length > 0 && lines.every((line) => line.issue === null),
  };
}
