import { z } from "zod";
import { json, route } from "@/lib/api/handler";
import { requireAdmin } from "@/server/admin/context";
import { listInventory } from "@/server/admin/inventory.service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(80).optional(),
  filter: z.enum(["all", "low", "out", "reserved"]).catch("all"),
  sort: z.enum(["urgency", "sku", "recent"]).catch("urgency"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** GET /api/admin/inventory?q&filter&sort&page - live stock table + summary. */
export const GET = route(async (request, { requestId }) => {
  await requireAdmin(request, "inventory:write", requestId, { write: false });
  const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return json(await listInventory(query));
});
