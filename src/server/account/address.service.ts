import { Errors } from "@/lib/api/errors";
import { db, withTransaction } from "@/lib/db";
import { normalizeIndianPhone, type AddressValues, type SavedAddress } from "@/schemas/account";

const MAX_ADDRESSES = 20;

const SELECT = {
  id: true,
  type: true,
  label: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  isDefault: true,
} as const;

export async function listAddresses(userId: string): Promise<SavedAddress[]> {
  return db.address.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: SELECT });
}

function toData(values: AddressValues) {
  return {
    type: values.type,
    label: values.label ?? null,
    fullName: values.fullName,
    phone: normalizeIndianPhone(values.phone),
    line1: values.line1,
    line2: values.line2 ?? null,
    landmark: values.landmark ?? null,
    city: values.city,
    state: values.state,
    postalCode: values.postalCode,
    countryCode: "IN",
  };
}

/** The first address is always the default; setting a default clears the previous one. */
export async function createAddress(userId: string, values: AddressValues): Promise<SavedAddress> {
  return withTransaction(async (tx) => {
    const count = await tx.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES) {
      throw Errors.unprocessable("address_limit", `You can save up to ${MAX_ADDRESSES} addresses.`);
    }
    const isDefault = values.isDefault || count === 0;
    if (isDefault) {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.address.create({ data: { ...toData(values), userId, isDefault }, select: SELECT });
  });
}

export async function updateAddress(userId: string, addressId: string, values: AddressValues): Promise<SavedAddress> {
  return withTransaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id: addressId, userId }, select: { id: true, isDefault: true } });
    if (!existing) throw Errors.notFound("Address");
    const isDefault = values.isDefault || existing.isDefault;
    if (isDefault && !existing.isDefault) {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.address.update({ where: { id: addressId }, data: { ...toData(values), isDefault }, select: SELECT });
  });
}

/** Deleting the default promotes the oldest remaining address. Orders keep their own snapshot. */
export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id: addressId, userId }, select: { isDefault: true } });
    if (!existing) throw Errors.notFound("Address");
    await tx.address.delete({ where: { id: addressId } });
    if (existing.isDefault) {
      const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}
