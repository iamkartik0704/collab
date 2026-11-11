import { AdminAuditAction } from "@prisma/client";
import { z } from "zod";
import { route } from "@/lib/api/handler";
import { csvCell, listAuditLog } from "@/server/admin/audit-log.service";
import { requireAdmin } from "@/server/admin/context";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  action: z.enum(AdminAuditAction).optional().catch(undefined),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
});

/** GET /api/admin/audit-log/export - CSV of the filtered audit trail (newest 5,000 entries). */
export const GET = route(async (request, { requestId }) => {
  await requireAdmin(request, "audit:read", requestId, { write: false });
  const filters = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const { rows } = await listAuditLog({ ...filters, limit: 5000 });
  const header = ["timestamp", "actor", "role", "action", "entity_type", "entity_id", "reason", "changes", "ip", "request_id"];
  const lines = rows.map((row) =>
    [row.createdAt, row.actor.email ?? row.actor.name, row.actorRole, row.action, row.entityType, row.entityId, row.reason, row.diff ?? row.after, row.ip, row.requestId]
      .map(csvCell)
      .join(","),
  );
  return new Response([header.join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
