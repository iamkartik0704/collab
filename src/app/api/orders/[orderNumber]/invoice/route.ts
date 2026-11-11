import { Errors } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { hasPermission } from "@/lib/auth/rbac";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureInvoice, InvoiceNotAvailableError } from "@/server/invoices/invoice.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/orders/:orderNumber/invoice - the GST invoice PDF (order owner or staff with orders:read). */
export const GET = route<{ orderNumber: string }>(async (_request, { params }) => {
  const user = await requireUser();
  const order = await db.order.findUnique({ where: { orderNumber: params.orderNumber.toUpperCase() }, select: { id: true, userId: true } });
  // Same 404 for "not yours" and "does not exist": order numbers are not enumerable.
  if (!order || (order.userId !== user.id && !hasPermission(user.role, "orders:read"))) throw Errors.notFound("Order");
  try {
    const invoice = await ensureInvoice(order.id);
    return new Response(new Uint8Array(invoice.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof InvoiceNotAvailableError) throw Errors.conflict("invoice_unavailable", error.message);
    throw error;
  }
});
