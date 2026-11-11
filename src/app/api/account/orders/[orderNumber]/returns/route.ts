import { json, readJson, route } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { createReturnRequest, returnRequestInputSchema } from "@/server/returns/return.service";

export const dynamic = "force-dynamic";

/** POST /api/account/orders/:orderNumber/returns { orderItemId, type, quantity, reason, description } */
export const POST = route<{ orderNumber: string }>(async (request, { params }) => {
  const user = await requireUser();
  const body = await readJson(request, returnRequestInputSchema);
  const result = await createReturnRequest(user.id, params.orderNumber.toUpperCase(), body);
  return json(result, { status: 201 });
});
