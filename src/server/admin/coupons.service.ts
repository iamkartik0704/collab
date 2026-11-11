import type { Prisma } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { db, isCheckViolation, isUniqueConstraintError, withTransaction } from "@/lib/db";
import { couponInputSchema, type CouponFormValues } from "@/schemas/admin";
import { writeAudit } from "./audit";
import type { AdminContext } from "./context";

export type CouponState = "active" | "scheduled" | "expired" | "exhausted" | "disabled";

export interface AdminCouponRow {
  id: string;
  code: string;
  description: string | null;
  discountType: "PERCENTAGE" | "FLAT";
  percentOffBps: number | null;
  maxDiscountMinor: number | null;
  amountOffMinor: number | null;
  minCartValueMinor: number;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  timesRedeemed: number;
  firstOrderOnly: boolean;
  startsAt: string;
  expiresAt: string | null;
  isActive: boolean;
  categoryIds: string[];
  brandIds: string[];
  scope: string;
  state: CouponState;
  /** Discount given on completed redemptions. */
  discountGivenMinor: number;
}

function couponState(coupon: { isActive: boolean; startsAt: Date; expiresAt: Date | null; usageLimitTotal: number | null; timesRedeemed: number }, now = new Date()): CouponState {
  if (!coupon.isActive) return "disabled";
  if (coupon.expiresAt && coupon.expiresAt <= now) return "expired";
  if (coupon.usageLimitTotal !== null && coupon.timesRedeemed >= coupon.usageLimitTotal) return "exhausted";
  if (coupon.startsAt > now) return "scheduled";
  return "active";
}

const COUPON_INCLUDE = {
  categories: { select: { id: true, name: true } },
  brands: { select: { id: true, name: true } },
} satisfies Prisma.CouponInclude;

type CouponWithScope = Prisma.CouponGetPayload<{ include: typeof COUPON_INCLUDE }>;

function toRow(coupon: CouponWithScope, discountGivenMinor: number): AdminCouponRow {
  const scopeParts = [
    coupon.categories.length ? coupon.categories.map((category) => category.name).join(", ") : null,
    coupon.brands.length ? coupon.brands.map((brand) => brand.name).join(", ") : null,
  ].filter(Boolean);
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    percentOffBps: coupon.percentOffBps,
    maxDiscountMinor: coupon.maxDiscountMinor,
    amountOffMinor: coupon.amountOffMinor,
    minCartValueMinor: coupon.minCartValueMinor,
    usageLimitTotal: coupon.usageLimitTotal,
    usageLimitPerUser: coupon.usageLimitPerUser,
    timesRedeemed: coupon.timesRedeemed,
    firstOrderOnly: coupon.firstOrderOnly,
    startsAt: coupon.startsAt.toISOString(),
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
    isActive: coupon.isActive,
    categoryIds: coupon.categories.map((category) => category.id),
    brandIds: coupon.brands.map((brand) => brand.id),
    scope: scopeParts.length ? scopeParts.join(" · ") : "Entire catalogue",
    state: couponState(coupon),
    discountGivenMinor,
  };
}

export async function listCoupons(input: { q?: string | undefined; state?: CouponState | undefined }): Promise<AdminCouponRow[]> {
  const q = input.q?.trim().toUpperCase();
  const coupons = await db.coupon.findMany({
    where: q ? { OR: [{ code: { contains: q } }, { description: { contains: input.q!.trim(), mode: "insensitive" } }] } : {},
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: COUPON_INCLUDE,
    take: 500,
  });
  const given = await db.couponRedemption.groupBy({
    by: ["couponId"],
    where: { couponId: { in: coupons.map((coupon) => coupon.id) }, order: { placedAt: { not: null } } },
    _sum: { discountMinor: true },
  });
  const givenById = new Map(given.map((row) => [row.couponId, row._sum.discountMinor ?? 0]));
  const rows = coupons.map((coupon) => toRow(coupon, givenById.get(coupon.id) ?? 0));
  return input.state ? rows.filter((row) => row.state === input.state) : rows;
}

export async function getCouponScopeOptions() {
  const [categories, brands] = await Promise.all([
    db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { categories, brands };
}

function auditView(coupon: CouponWithScope | null) {
  if (!coupon) return null;
  return {
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    percentOffBps: coupon.percentOffBps,
    maxDiscountMinor: coupon.maxDiscountMinor,
    amountOffMinor: coupon.amountOffMinor,
    minCartValueMinor: coupon.minCartValueMinor,
    usageLimitTotal: coupon.usageLimitTotal,
    usageLimitPerUser: coupon.usageLimitPerUser,
    firstOrderOnly: coupon.firstOrderOnly,
    startsAt: coupon.startsAt,
    expiresAt: coupon.expiresAt,
    isActive: coupon.isActive,
    categoryIds: coupon.categories.map((category) => category.id).sort(),
    brandIds: coupon.brands.map((brand) => brand.id).sort(),
  };
}

function mapWriteError(error: unknown): never {
  if (isUniqueConstraintError(error, "code")) throw Errors.conflict("code_taken", "A coupon with this code already exists.");
  if (isCheckViolation(error, "Coupon_limits_valid")) {
    throw Errors.unprocessable("invalid_limits", "The usage limit cannot be below the number of times the coupon was already used.");
  }
  if (isCheckViolation(error, "Coupon_discount_shape")) throw Errors.unprocessable("invalid_discount", "The discount settings are inconsistent.");
  throw error;
}

export async function saveCoupon(ctx: AdminContext, couponId: string | null, values: CouponFormValues): Promise<{ id: string }> {
  const input = couponInputSchema.parse(values);
  try {
    return await withTransaction(async (tx) => {
      const [categories, brands] = await Promise.all([
        tx.category.count({ where: { id: { in: input.categoryIds } } }),
        tx.brand.count({ where: { id: { in: input.brandIds } } }),
      ]);
      if (categories !== input.categoryIds.length || brands !== input.brandIds.length) {
        throw Errors.unprocessable("invalid_scope", "A selected category or brand no longer exists.");
      }

      const before = couponId ? await tx.coupon.findUnique({ where: { id: couponId }, include: COUPON_INCLUDE }) : null;
      if (couponId && !before) throw Errors.notFound("Coupon");
      if (before && before.code !== input.code && before.timesRedeemed > 0) {
        throw Errors.conflict("code_locked", "The code of a coupon that has been used cannot change. Create a new coupon instead.");
      }
      if (before && input.usageLimitTotal !== null && input.usageLimitTotal < before.timesRedeemed) {
        throw Errors.unprocessable("invalid_limits", `This coupon was already used ${before.timesRedeemed} time(s); the limit cannot be lower.`);
      }

      const data = {
        code: input.code,
        description: input.description,
        discountType: input.discountType,
        percentOffBps: input.percentOffBps,
        maxDiscountMinor: input.maxDiscountMinor,
        amountOffMinor: input.amountOffMinor,
        minCartValueMinor: input.minCartValueMinor,
        usageLimitTotal: input.usageLimitTotal,
        usageLimitPerUser: input.usageLimitPerUser,
        firstOrderOnly: input.firstOrderOnly,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        isActive: input.isActive,
      };
      const saved = before
        ? await tx.coupon.update({
            where: { id: before.id },
            data: {
              ...data,
              categories: { set: input.categoryIds.map((id) => ({ id })) },
              brands: { set: input.brandIds.map((id) => ({ id })) },
            },
            include: COUPON_INCLUDE,
          })
        : await tx.coupon.create({
            data: {
              ...data,
              createdById: ctx.actor.id,
              categories: { connect: input.categoryIds.map((id) => ({ id })) },
              brands: { connect: input.brandIds.map((id) => ({ id })) },
            },
            include: COUPON_INCLUDE,
          });

      await writeAudit(tx, ctx, {
        action: before ? "COUPON_CHANGE" : "CREATE",
        entityType: "Coupon",
        entityId: saved.id,
        before: auditView(before),
        after: auditView(saved),
      });
      return { id: saved.id };
    });
  } catch (error) {
    mapWriteError(error);
  }
}

/** Never-used coupons are deleted; used ones are disabled so order history stays intact. */
export async function deleteCoupon(ctx: AdminContext, couponId: string): Promise<{ outcome: "deleted" | "disabled" }> {
  return withTransaction(async (tx) => {
    const coupon = await tx.coupon.findUnique({ where: { id: couponId }, include: COUPON_INCLUDE });
    if (!coupon) throw Errors.notFound("Coupon");
    const used = coupon.timesRedeemed > 0 || (await tx.couponRedemption.count({ where: { couponId } })) > 0 || (await tx.order.count({ where: { couponId } })) > 0;
    if (used) {
      await tx.coupon.update({ where: { id: couponId }, data: { isActive: false } });
      await writeAudit(tx, ctx, { action: "COUPON_CHANGE", entityType: "Coupon", entityId: couponId, before: { isActive: coupon.isActive }, after: { isActive: false }, reason: "delete requested; coupon has been used, so it was disabled" });
      return { outcome: "disabled" as const };
    }
    await tx.coupon.delete({ where: { id: couponId } });
    await writeAudit(tx, ctx, { action: "DELETE", entityType: "Coupon", entityId: couponId, before: auditView(coupon) });
    return { outcome: "deleted" as const };
  });
}
