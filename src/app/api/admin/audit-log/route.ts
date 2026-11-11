import { AdminAuditAction } from "@prisma/client";
import { z } from "zod";
import { json, route } from "@/lib/api/handler";
import { listAuditLog } from "@/server/admin/audit-log.service";
import { requireAdmin } from "@/server/admin/context";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  action: z.enum(AdminAuditAction).optional().catch(undefined),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
  cursor: z.string().max(200).optional(),
});

/** GET /api/admin/audit-log - newest-first audit entries, 50 per page, keyset cursor. */
export const GET = route(async (request, { requestId }) => {
  await requireAdmin(request, "audit:read", requestId, { write: false });
  const filters = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return json(await listAuditLog({ ...filters, limit: 50 }));
});
