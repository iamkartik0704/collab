import { describe, expect, it } from "vitest";
import { dayBound, parseRupees, rupeesText } from "@/lib/admin/format";
import { couponInputSchema, ORDER_TRANSITIONS, stockAdjustmentSchema, variantOptionKey } from "@/schemas/admin";

describe("rupee parsing", () => {
  it("round-trips minor units", () => {
    expect(parseRupees("1,19,900")).toBe(11_990_000);
    expect(parseRupees("49.5")).toBe(4950);
    expect(parseRupees("")).toBeNull();
    expect(Number.isNaN(parseRupees("12.345"))).toBe(true);
    expect(rupeesText(4950)).toBe("49.50");
    expect(rupeesText(100_000)).toBe("1000");
  });

  it("maps a calendar day to IST bounds", () => {
    expect(dayBound("2026-11-04", false)).toBe("2026-11-04T00:00:00.000+05:30");
    expect(dayBound("2026-11-04", true)).toBe("2026-11-04T23:59:59.999+05:30");
    expect(dayBound("04/11/2026", false)).toBeUndefined();
  });
});

describe("variantOptionKey", () => {
  it("is case-insensitive on colour and stable for missing options", () => {
    expect(variantOptionKey({ color: " Black ", storageGb: 256, ramGb: null })).toBe("black|256|-");
    expect(variantOptionKey({})).toBe("-|-|-");
  });
});

describe("couponInputSchema", () => {
  const base = {
    code: "save10",
    description: "",
    discountType: "PERCENTAGE" as const,
    percentOffBps: 1000,
    maxDiscountMinor: 50_000,
    amountOffMinor: 999,
    minCartValueMinor: 0,
    usageLimitTotal: null,
    usageLimitPerUser: 1,
    firstOrderOnly: false,
    startsAt: "2026-11-01T00:00:00Z",
    expiresAt: null,
    isActive: true,
    categoryIds: [],
    brandIds: [],
  };

  it("normalises the code and drops fields of the other discount type", () => {
    const parsed = couponInputSchema.parse(base);
    expect(parsed.code).toBe("SAVE10");
    expect(parsed.amountOffMinor).toBeNull();
    const flat = couponInputSchema.parse({ ...base, discountType: "FLAT", amountOffMinor: 50_000 });
    expect(flat.percentOffBps).toBeNull();
    expect(flat.maxDiscountMinor).toBeNull();
  });

  it("rejects an expiry before the start", () => {
    expect(couponInputSchema.safeParse({ ...base, expiresAt: "2026-10-01T00:00:00Z" }).success).toBe(false);
  });
});

describe("stock adjustments", () => {
  it("requires a note for write-offs and a non-negative physical count", () => {
    expect(stockAdjustmentSchema.safeParse({ mode: "delta", quantity: -2, reason: "LOST_OR_STOLEN" }).success).toBe(false);
    expect(stockAdjustmentSchema.safeParse({ mode: "set", quantity: -1, reason: "CYCLE_COUNT_CORRECTION" }).success).toBe(false);
    expect(stockAdjustmentSchema.safeParse({ mode: "delta", quantity: 5, reason: "PURCHASE_ORDER_RECEIVED" }).success).toBe(true);
  });
});

describe("order state machine", () => {
  it("has no transitions out of terminal states and never skips payment", () => {
    for (const terminal of ["CANCELLED", "PAYMENT_FAILED", "RETURNED"] as const) expect(ORDER_TRANSITIONS[terminal]).toEqual([]);
    expect(ORDER_TRANSITIONS.PENDING_PAYMENT).toEqual(["CANCELLED"]);
  });
});
