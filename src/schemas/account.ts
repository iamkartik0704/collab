import { z } from "zod";

/** Shared by the checkout address form (react-hook-form) and /api/account/addresses. */

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

export const addressSchema = z.object({
  type: z.enum(["HOME", "OFFICE", "OTHER"]),
  label: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  fullName: z.string().trim().min(2, "Enter the recipient's name").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/, "Enter a valid 10-digit Indian mobile number"),
  line1: z.string().trim().min(3, "Enter house / flat and street").max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  landmark: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  city: z.string().trim().min(2, "Enter a city").max(80),
  state: z.enum(INDIAN_STATES, { message: "Choose a state" }),
  postalCode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code"),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.input<typeof addressSchema>;
export type AddressValues = z.output<typeof addressSchema>;

/** +91 E.164 normalisation of the validated phone. */
export function normalizeIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+91${digits.slice(-10)}`;
}

export const reviewSchema = z.object({
  rating: z.number().int().min(1, "Choose a rating").max(5),
  title: z.string().trim().min(3, "Add a short title").max(120),
  body: z.string().trim().min(20, "Tell others a bit more (20+ characters)").max(4000),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export interface SavedAddress {
  id: string;
  type: "HOME" | "OFFICE" | "OTHER";
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  isDefault: boolean;
}
