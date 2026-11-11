/**
 * GSTIN (Goods and Services Tax Identification Number) validation: 15 characters
 * (2-digit state code, 10-character PAN, entity number, "Z", check character) whose last
 * character is the mod-36 checksum defined by GSTN. Client-safe (no imports).
 */

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const value = CHARSET.indexOf(first14[index]!);
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export function normalizeGstin(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidGstin(raw: string): boolean {
  const gstin = normalizeGstin(raw);
  const stateCode = Number(gstin.slice(0, 2));
  return GSTIN_PATTERN.test(gstin) && stateCode >= 1 && stateCode <= 38 && gstinCheckCharacter(gstin.slice(0, 14)) === gstin[14];
}
