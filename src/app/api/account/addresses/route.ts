import { json, readJson, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { addressSchema } from "@/schemas/account";
import { createAddress, listAddresses } from "@/server/account/address.service";

export const dynamic = "force-dynamic";

/** GET /api/account/addresses */
export const GET = route(async () => {
  const user = await requireUser();
  return json({ addresses: await listAddresses(user.id) });
});

/** POST /api/account/addresses */
export const POST = route(async (request) => {
  const user = await requireUser();
  const values = await readJson(request, addressSchema);
  return json({ address: await createAddress(user.id, values) }, { status: 201 });
});
