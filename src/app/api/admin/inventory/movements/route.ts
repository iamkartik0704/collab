import { StockMovementType } from "@prisma/client";
import { z } from "zod";
import { json, route } from "@/lib/api/handler";
import { csvCell } from "@/server/admin/audit-log.service";
import { requireAdmin } from "@/server/admin/context";
import { listMovements } from "@/server/admin/inventory.service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  variantId: z.string().max(64).optional(),
  type: z.enum(StockMovementType).optional().catch(undefined),
  q: z.string().max(80).optional(),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
  cursor: z.string().max(200).optional(),
  format: z.enum(["json", "csv"]).catch("json"),
});

/** GET /api/admin/inventory/movements - append-only stock ledger (JSON pages or CSV export). */
export const GET = route(async (request, { requestId }) => {
  await requireAdmin(request, "inventory:write", requestId, { write: false });
  const { format, ...filters } = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  if (format === "json") return json(await listMovements({ ...filters, limit: 50 }));

  const { rows } = await listMovements({ ...filters, cursor: undefined, limit: 1000 });
  const header = ["timestamp", "sku", "product", "type", "reason", "on_hand_delta", "reserved_delta", "on_hand_after", "reserved_after", "available_after", "order", "actor", "note"];
  const lines = rows.map((row) =>
    [row.createdAt, row.sku, row.productName, row.type, row.reason, row.onHandDelta, row.reservedDelta, row.onHandAfter, row.reservedAfter, row.availableAfter, row.orderNumber, row.actor, row.note]
      .map(csvCell)
      .join(","),
  );
  return new Response([header.join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-movements-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
