import type { DiscountType } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import { allocateProportionally, percentOf } from "@/lib/money";

/**
 * Coupon evaluation and usage reservation.
 * Usage is reserved when the PENDING_PAYMENT order is created (guarded counter increment +
 * CouponRedemption row) and released with the stock reservation if payment never completes.
 * That makes "limited to 100 uses" and "once per customer" race-free under concurrency.
 */

const COUPON_CODE = /^[A-Z0-9_-]{3,40}$/;

export type CouponRejection =
  | "invalid_code"
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "user_limit_reached"
  | "first_order_only"
  | "min_cart_value"
  | "not_applicable";

const REJECTION_MESSAGES: Record<CouponRejection, string> = {
  invalid_code: "That coupon code is not valid.",
  not_found: "That coupon code is not valid.",
  inactive: "This coupon is no longer active.",
  not_started: "This coupon is not active yet.",
  expired: "This coupon has expired.",
  exhausted: "This coupon has reached its usage limit.",
  user_limit_reached: "You have already used this coupon.",
  first_order_only: "This coupon is only valid on your first order.",
  min_cart_value: "Your cart does not meet this coupon's minimum value.",
  not_applicable: "This coupon does not apply to any item in your cart.",
};

export interface CouponLine {
  variantId: string;
  categoryId: string;
  brandId: string;
  lineSubtotalMinor: number;
}

export type CouponEvaluation =
  | {
      ok: true;
      couponId: string;
      code: string;
      description: string | null;
      discountType: DiscountType;
      discountMinor: number;
      /** variantId -> discount allocated to that line. */
      perLineDiscount: Map<string, number>;
      usageLimitPerUser: number | null;
    }
  | { ok: false; code: CouponRejection; message: string; minCartValueMinor?: number };

export class CouponUnavailableError extends Error {
  constructor(readonly reason: CouponRejection) {
    super(REJECTION_MESSAGES[reason]);
    this.name = "CouponUnavailableError";
  }
}

export function normalizeCouponCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return COUPON_CODE.test(code) ? code : null;
}

function reject(code: CouponRejection, extra: { minCartValueMinor?: number } = {}): CouponEvaluation {
  return { ok: false, code, message: REJECTION_MESSAGES[code], ...extra };
}

/** Statuses that mean the customer completed a purchase. */
const PURCHASED_STATUSES = ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"] as const;

/**
 * Evaluates a coupon against priced cart lines. Per-customer rules are only checked when
 * `userId` is known; checkout always re-evaluates with the signed-in user.
 */
export async function evaluateCoupon(
  client: TransactionClient,
  input: { code: string; userId: string | null; lines: readonly CouponLine[]; now?: Date },
): Promise<CouponEvaluation> {
  const code = normalizeCouponCode(input.code);
  if (!code) return reject("invalid_code");
  const now = input.now ?? new Date();

  const coupon = await client.coupon.findUnique({
    where: { code },
    include: { categories: { select: { id: true } }, brands: { select: { id: true } } },
  });
  if (!coupon) return reject("not_found");
  if (!coupon.isActive) return reject("inactive");
  if (coupon.startsAt > now) return reject("not_started");
  if (coupon.expiresAt && coupon.expiresAt <= now) return reject("expired");
  if (coupon.usageLimitTotal !== null && coupon.timesRedeemed >= coupon.usageLimitTotal) return reject("exhausted");

  if (input.userId) {
    if (coupon.usageLimitPerUser !== null) {
      const used = await client.couponRedemption.count({ where: { couponId: coupon.id, userId: input.userId } });
      if (used >= coupon.usageLimitPerUser) return reject("user_limit_reached");
    }
    if (coupon.firstOrderOnly) {
      const previous = await client.order.count({
        where: { userId: input.userId, status: { in: [...PURCHASED_STATUSES] } },
      });
      if (previous > 0) return reject("first_order_only");
    }
  }

  const cartSubtotal = input.lines.reduce((sum, line) => sum + line.lineSubtotalMinor, 0);
  if (cartSubtotal < coupon.minCartValueMinor) {
    return reject("min_cart_value", { minCartValueMinor: coupon.minCartValueMinor });
  }

  const categoryIds = new Set(coupon.categories.map((category) => category.id));
  const brandIds = new Set(coupon.brands.map((brand) => brand.id));
  const eligible = input.lines.filter(
    (line) =>
      (categoryIds.size === 0 || categoryIds.has(line.categoryId)) && (brandIds.size === 0 || brandIds.has(line.brandId)),
  );
  const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.lineSubtotalMinor, 0);
  if (eligibleSubtotal === 0) return reject("not_applicable");

  let discountMinor: number;
  if (coupon.discountType === "PERCENTAGE") {
    discountMinor = percentOf(eligibleSubtotal, coupon.percentOffBps ?? 0);
    if (coupon.maxDiscountMinor !== null) {
      discountMinor = Math.min(discountMinor, coupon.maxDiscountMinor);
    }
  } else {
    discountMinor = Math.min(coupon.amountOffMinor ?? 0, eligibleSubtotal);
  }
  if (discountMinor <= 0) return reject("not_applicable");

  const allocation = allocateProportionally(
    discountMinor,
    eligible.map((line) => line.lineSubtotalMinor),
  );
  const perLineDiscount = new Map(eligible.map((line, index) => [line.variantId, allocation[index] ?? 0]));

  return {
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountMinor,
    perLineDiscount,
    usageLimitPerUser: coupon.usageLimitPerUser,
  };
}

/**
 * Reserves one use of the coupon for a pending order, inside the order transaction.
 * The total limit is enforced by a guarded UPDATE; the per-user limit by counting under the
 * per-user checkout lock. Throws CouponUnavailableError (the transaction rolls back).
 */
export async function reserveCouponRedemption(
  tx: TransactionClient,
  input: { couponId: string; userId: string; orderId: string; discountMinor: number; usageLimitPerUser: number | null },
): Promise<void> {
  const claimed = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "Coupon"
       SET "timesRedeemed" = "timesRedeemed" + 1, "updatedAt" = now()
     WHERE id = ${input.couponId}
       AND "isActive" = true
       AND ("usageLimitTotal" IS NULL OR "timesRedeemed" < "usageLimitTotal")
    RETURNING id`;
  if (claimed.length === 0) {
    throw new CouponUnavailableError("exhausted");
  }

  if (input.usageLimitPerUser !== null) {
    const used = await tx.couponRedemption.count({ where: { couponId: input.couponId, userId: input.userId } });
    if (used >= input.usageLimitPerUser) {
      throw new CouponUnavailableError("user_limit_reached");
    }
  }

  await tx.couponRedemption.create({
    data: { couponId: input.couponId, userId: input.userId, orderId: input.orderId, discountMinor: input.discountMinor },
  });
}

/** Gives the use back when a pending order is cancelled or expires. */
export async function releaseCouponRedemption(tx: TransactionClient, orderId: string): Promise<boolean> {
  const redemption = await tx.couponRedemption.findUnique({ where: { orderId }, select: { id: true, couponId: true } });
  if (!redemption) return false;
  await tx.couponRedemption.delete({ where: { id: redemption.id } });
  await tx.$executeRaw`
    UPDATE "Coupon" SET "timesRedeemed" = "timesRedeemed" - 1, "updatedAt" = now()
     WHERE id = ${redemption.couponId} AND "timesRedeemed" > 0`;
  return true;
}

/**
 * Re-records a redemption for an order paid after its reservation expired. The customer paid
 * the discounted price, so the use is recorded even if the limit has since been reached.
 */
export async function restoreCouponRedemption(
  tx: TransactionClient,
  input: { couponId: string; userId: string; orderId: string; discountMinor: number },
): Promise<void> {
  const existing = await tx.couponRedemption.findUnique({ where: { orderId: input.orderId }, select: { id: true } });
  if (existing) return;
  await tx.couponRedemption.create({ data: input });
  await tx.$executeRaw`
    UPDATE "Coupon" SET "timesRedeemed" = "timesRedeemed" + 1, "updatedAt" = now() WHERE id = ${input.couponId}`;
}
