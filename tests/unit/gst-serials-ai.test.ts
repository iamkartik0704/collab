import { describe, expect, it } from "vitest";
import { gstinCheckCharacter, isValidGstin, normalizeGstin } from "@/lib/gstin";
import { deviceSerialSchema, isValidImei, itemSerialsSchema } from "@/schemas/admin";
import { checkoutSchema } from "@/schemas/checkout";
import { guestOwnsOrder } from "@/server/ai/tools";

// Builds a checksum-valid GSTIN from its first 14 characters.
const gstin = (first14: string) => first14 + gstinCheckCharacter(first14);

describe("GSTIN", () => {
  it("accepts a checksum-valid GSTIN in any case / spacing", () => {
    const valid = gstin("29ABCDE1234F1Z");
    expect(isValidGstin(valid)).toBe(true);
    expect(isValidGstin(` ${valid.toLowerCase()} `)).toBe(true);
    expect(normalizeGstin(" 29abcde1234f1z5 ")).toBe("29ABCDE1234F1Z5");
  });

  it("rejects a wrong check character, bad state code or bad shape", () => {
    const valid = gstin("29ABCDE1234F1Z");
    const wrongCheck = valid.slice(0, 14) + (valid[14] === "A" ? "B" : "A");
    expect(isValidGstin(wrongCheck)).toBe(false);
    expect(isValidGstin(gstin("99ABCDE1234F1Z"))).toBe(false);
    expect(isValidGstin("29ABCDE1234F1Y5")).toBe(false);
    expect(isValidGstin("29ABCDE1234F1Z")).toBe(false);
  });

  it("is optional at checkout and normalised when present", () => {
    const base = { addressId: "addr_1234567890", shippingMethodCode: "FREE_STANDARD", provider: "STRIPE" as const };
    expect(checkoutSchema.safeParse(base).success).toBe(true);
    const parsed = checkoutSchema.parse({ ...base, customerGstin: gstin("27AAPFU0939F1Z").toLowerCase() });
    expect(parsed.customerGstin).toBe(gstin("27AAPFU0939F1Z"));
    expect(checkoutSchema.safeParse({ ...base, customerGstin: "27AAPFU0939F1ZX" }).success).toBe(false);
  });
});

describe("device serials", () => {
  it("validates IMEIs with the Luhn check and accepts manufacturer serials", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(deviceSerialSchema.safeParse("490154203237519").success).toBe(false);
    expect(deviceSerialSchema.parse(" c02xk0abjg5h ")).toBe("C02XK0ABJG5H");
    expect(deviceSerialSchema.safeParse("ab").success).toBe(false);
  });

  it("rejects the same serial twice on one order", () => {
    const result = itemSerialsSchema.safeParse([
      { orderItemId: "a", serialNumbers: ["490154203237518"] },
      { orderItemId: "b", serialNumbers: ["490154203237518"] },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("guest order lookup (AI tool)", () => {
  const owner = { email: "Priya.Iyer@example.com", phone: "+919876543210" };

  it("accepts the order's email (any case) or phone (any format)", () => {
    expect(guestOwnsOrder(owner, { email: "priya.iyer@example.com" })).toBe(true);
    expect(guestOwnsOrder(owner, { phone: "98765 43210" })).toBe(true);
    expect(guestOwnsOrder(owner, { phone: "+91-98765-43210" })).toBe(true);
  });

  it("refuses missing, wrong or partial proof", () => {
    expect(guestOwnsOrder(owner, {})).toBe(false);
    expect(guestOwnsOrder(owner, { email: "someone@example.com" })).toBe(false);
    expect(guestOwnsOrder(owner, { phone: "43210" })).toBe(false);
    expect(guestOwnsOrder({ email: null, phone: null }, { email: "", phone: "" })).toBe(false);
  });
});
