import { describe, expect, it } from "vitest";
import { amountInWords, financialYear, inr } from "@/server/invoices/invoice.service";

describe("financialYear (April-March, IST)", () => {
  it("rolls over on 1 April IST", () => {
    expect(financialYear(new Date("2026-03-31T18:29:00Z"))).toBe("2025-26"); // 31 Mar 23:59 IST
    expect(financialYear(new Date("2026-03-31T18:31:00Z"))).toBe("2026-27"); // 1 Apr 00:01 IST
    expect(financialYear(new Date("2099-12-31T00:00:00Z"))).toBe("2099-00");
  });
});

describe("amountInWords (Indian numbering)", () => {
  it.each([
    [0, "Rupees Zero Only"],
    [100, "Rupees One Only"],
    [11_990_000, "Rupees One Lakh Nineteen Thousand Nine Hundred Only"],
    [12_345_678, "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only"],
    [2_500_000_000, "Rupees Two Crore Fifty Lakh Only"],
  ])("%i paise", (minor, words) => {
    expect(amountInWords(minor)).toBe(words);
  });
});

describe("inr", () => {
  it("formats with Indian grouping and two decimals", () => {
    expect(inr(11_990_000)).toBe("INR 1,19,900.00");
    expect(inr(-50)).toBe("-INR 0.50");
  });
});
