import { z } from "zod";
import { json, readJson, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { addressSchema } from "@/schemas/account";
import { deleteAddress, updateAddress } from "@/server/account/address.service";

export const dynamic = "force-dynamic";

const idSchema = z.string().regex(/^[a-z0-9]{10,40}$/);

/** PATCH /api/account/addresses/:id (full replacement of the editable fields) */
export const PATCH = route<{ id: string }>(async (request, { params }) => {
  const user = await requireUser();
  const values = await readJson(request, addressSchema);
  return json({ address: await updateAddress(user.id, idSchema.parse(params.id), values) });
});

/** DELETE /api/account/addresses/:id */
export const DELETE = route<{ id: string }>(async (_request, { params }) => {
  const user = await requireUser();
  await deleteAddress(user.id, idSchema.parse(params.id));
  return json({ deleted: true });
});
