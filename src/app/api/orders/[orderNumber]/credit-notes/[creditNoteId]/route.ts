import { Errors } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { hasPermission } from "@/lib/auth/rbac";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureCreditNote } from "@/server/invoices/invoice.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/orders/:orderNumber/credit-notes/:creditNoteId - GST credit note PDF (owner or staff). */
export const GET = route<{ orderNumber: string; creditNoteId: string }>(async (_request, { params }) => {
  const user = await requireUser();
  const note = await db.creditNote.findUnique({ where: { id: params.creditNoteId }, select: { refundId: true, order: { select: { orderNumber: true, userId: true } } } });
  if (!note || note.order.orderNumber !== params.orderNumber.toUpperCase() || (note.order.userId !== user.id && !hasPermission(user.role, "orders:read"))) {
    throw Errors.notFound("Credit note");
  }
  const file = await ensureCreditNote(note.refundId);
  return new Response(new Uint8Array(file.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
