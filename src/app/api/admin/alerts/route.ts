import { json, route } from "@/lib/api/handler";
import { requireAdmin } from "@/server/admin/context";
import { listAlerts, visibleAlertTypes } from "@/server/admin/inventory.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/alerts?all=1 - alert feed filtered to the alert types this role handles. */
export const GET = route(async (request, { requestId }) => {
  const ctx = await requireAdmin(request, "admin:access", requestId, { write: false });
  const includeAcknowledged = request.nextUrl.searchParams.get("all") === "1";
  return json({ alerts: await listAlerts({ types: visibleAlertTypes(ctx.actor.role), includeAcknowledged }) });
});
