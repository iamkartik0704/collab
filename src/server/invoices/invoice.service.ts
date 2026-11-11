import { env } from "@/env";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { getObjectBytes, putObject } from "@/lib/storage/s3";
import type { InvoiceData } from "@/invoices/invoice-document";

/**
 * GST tax invoices. One invoice per paid order, numbered INV/<financial year>/<serial> from a
 * PostgreSQL sequence (concurrency-safe; a crashed render can leave a gap, which GST rules
 * accept when documented). The PDF lives in the private part of the bucket under invoices/ and
 * is regenerated from the order snapshot if the object is ever missing.
 */

const log = childLogger({ service: "invoices" });
const TIME_ZONE = "Asia/Kolkata";

export class InvoiceNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceNotAvailableError";
  }
}

/** Indian financial year (April-March) of a date in IST, e.g. "2026-27". */
export function financialYear(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function inr(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  return `${sign}INR ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(minor) / 100)}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const restText = rest < 20 ? ONES[rest]! : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${ONES[rest % 10]}` : ""}`;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", restText].filter(Boolean).join(" ");
}

/** Indian numbering (lakh / crore): 123456789 paise -> "Rupees Twelve Lakh Thirty Four Thousand ...". */
export function amountInWords(minor: number): string {
  let rupees = Math.floor(minor / 100);
  const paise = minor % 100;
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${amountInWords(crore * 100).replace(/^Rupees | Only$/g, "")} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${belowThousand(paise)} Paise` : ""} Only`;
}

/** Table cells: plain amounts (the table header says INR). */
function amount(minor: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(date);
}

async function loadOrder(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      // product / category HSN: fallback for lines snapshotted without one (older orders).
      items: { orderBy: { createdAt: "asc" }, include: { product: { select: { hsnCode: true, category: { select: { hsnCode: true } } } } } },
      user: { select: { name: true, email: true } },
      payments: { where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}
type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

function lineHsn(item: LoadedOrder["items"][number]): string | null {
  return item.hsnCode ?? item.product.hsnCode ?? item.product.category.hsnCode;
}

function seller(): InvoiceData["seller"] {
  return { name: env.INVOICE_SELLER_NAME, address: env.INVOICE_SELLER_ADDRESS, gstin: env.INVOICE_SELLER_GSTIN ?? null, state: env.INVOICE_SELLER_STATE };
}

function buyer(order: LoadedOrder): { buyer: InvoiceData["buyer"]; supply: InvoiceData["supply"] } {
  const address = (order.shippingAddress ?? {}) as Record<string, string | null | undefined>;
  const state = address.state ?? null;
  return {
    supply: state && state.trim().toLowerCase() === env.INVOICE_SELLER_STATE.trim().toLowerCase() ? "intra" : "inter",
    buyer: {
      name: address.fullName ?? order.user.name ?? "Customer",
      lines: [address.line1, address.line2, address.landmark ? `Near ${address.landmark}` : null, [address.city, address.state, address.postalCode].filter(Boolean).join(", "), address.phone]
        .filter((line): line is string => Boolean(line)),
      state,
      email: order.user.email,
      gstin: order.customerGstin,
    },
  };
}

function providerName(provider: string | undefined): string {
  return provider === "STRIPE" ? "Stripe" : provider === "RAZORPAY" ? "Razorpay" : "-";
}

function buildInvoiceData(order: LoadedOrder, invoiceNumber: string, issuedAt: Date): InvoiceData {
  const { buyer: billedTo, supply } = buyer(order);
  const taxTotal = order.items.reduce((sum, item) => sum + item.taxMinor, 0);
  const taxable = order.items.reduce((sum, item) => sum + item.lineTotalMinor - item.taxMinor, 0);
  const half = Math.floor(taxTotal / 2);
  const payment = order.payments[0];
  return {
    kind: "invoice",
    invoiceNumber,
    invoiceDate: formatDate(issuedAt),
    orderNumber: order.orderNumber,
    orderDate: formatDate(order.placedAt ?? order.createdAt),
    reference: null,
    seller: seller(),
    buyer: billedTo,
    supply,
    lines: order.items.map((item) => ({
      description: `${item.productName} (${item.variantTitle})`,
      sku: item.sku,
      hsn: lineHsn(item),
      quantity: item.quantity,
      unitPrice: amount(item.unitPriceMinor),
      taxableValue: amount(item.lineTotalMinor - item.taxMinor),
      ratePercent: `${(item.taxRateBps / 100).toFixed(item.taxRateBps % 100 ? 2 : 0)}%`,
      tax: amount(item.taxMinor),
      total: amount(item.lineTotalMinor),
      serials: item.serialNumbers,
    })),
    totals: {
      taxable: inr(taxable),
      cgst: supply === "intra" ? inr(half) : null,
      sgst: supply === "intra" ? inr(taxTotal - half) : null,
      igst: supply === "inter" ? inr(taxTotal) : null,
      shipping: order.shippingMinor === 0 ? "Free" : inr(order.shippingMinor),
      discount: order.discountMinor > 0 ? inr(order.discountMinor) : null,
      total: inr(order.totalMinor),
      totalInWords: amountInWords(order.totalMinor),
    },
    payment: {
      provider: providerName(payment?.provider),
      reference: payment?.providerPaymentId ?? null,
      paidAt: payment?.capturedAt ? formatDate(payment.capturedAt) : null,
    },
  };
}

async function render(data: InvoiceData): Promise<Buffer> {
  // Both loaded lazily: react-pdf is ESM-only in parts and heavy; most requests never need it.
  const [pdf, { createInvoiceDocument }] = await Promise.all([import("@react-pdf/renderer"), import("@/invoices/invoice-document")]);
  return pdf.renderToBuffer(createInvoiceDocument(pdf, data));
}

export interface InvoiceFile {
  invoiceNumber: string;
  filename: string;
  pdf: Buffer;
}

/**
 * Returns the order's invoice PDF, issuing the invoice on first use. Idempotent and safe to
 * call concurrently (the number is claimed with a conditional update; losers reuse it).
 */
export async function ensureInvoice(orderId: string): Promise<InvoiceFile> {
  let order = await loadOrder(orderId);
  if (!order) throw new InvoiceNotAvailableError("Order not found.");
  if (!order.placedAt || ["PENDING_PAYMENT", "PAYMENT_FAILED"].includes(order.status)) {
    throw new InvoiceNotAvailableError("The invoice is issued once payment is confirmed.");
  }

  if (!order.invoiceNumber) {
    const [row] = await db.$queryRaw<Array<{ seq: bigint }>>`SELECT nextval('invoice_number_seq') AS seq`;
    if (!row) throw new Error("invoice sequence returned no value");
    const candidate = `INV/${financialYear(order.placedAt)}/${String(row.seq).padStart(6, "0")}`;
    await db.order.updateMany({ where: { id: orderId, invoiceNumber: null }, data: { invoiceNumber: candidate, invoiceGeneratedAt: new Date() } });
    order = (await loadOrder(orderId))!;
  }
  const invoiceNumber = order.invoiceNumber!;
  const filename = `${invoiceNumber.replace(/\//g, "-")}.pdf`;
  const key = `invoices/${order.orderNumber}/${filename}`;

  if (order.invoiceStorageKey) {
    const stored = await getObjectBytes(order.invoiceStorageKey).catch((error: unknown) => {
      log.warn({ err: error, orderId }, "invoice object unreadable; re-rendering");
      return null;
    });
    if (stored) return { invoiceNumber, filename, pdf: Buffer.from(stored) };
  }

  const pdf = await render(buildInvoiceData(order, invoiceNumber, order.invoiceGeneratedAt ?? new Date()));
  try {
    await putObject({ key, body: pdf, contentType: "application/pdf", cacheControl: "private, no-store" });
    await db.order.update({ where: { id: orderId }, data: { invoiceStorageKey: key } });
  } catch (error) {
    // Storage outage: the PDF is still returned (it is reproducible from the order snapshot).
    log.error({ err: error, orderId }, "failed to store invoice PDF");
  }
  return { invoiceNumber, filename, pdf };
}

// ============================================================================ credit notes

export interface CreditNoteFile {
  creditNoteNumber: string;
  filename: string;
  pdf: Buffer;
}

/**
 * GST credit note for a successful refund (section 34 CGST Act), referencing the order's tax
 * invoice (issued first if needed). GST is reversed in proportion to the GST charged on the
 * goods, never more than what remains on the invoice. Idempotent per refund.
 */
export async function ensureCreditNote(refundId: string): Promise<CreditNoteFile> {
  const refund = await db.refund.findUnique({ where: { id: refundId }, include: { creditNote: true } });
  if (!refund) throw new InvoiceNotAvailableError("Refund not found.");
  if (refund.status !== "SUCCEEDED") throw new InvoiceNotAvailableError("A credit note is issued once the refund has gone through.");

  const invoice = await ensureInvoice(refund.orderId);
  const order = (await loadOrder(refund.orderId))!;

  let note = refund.creditNote;
  if (!note) {
    const goodsTotal = order.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const goodsTax = order.items.reduce((sum, item) => sum + item.taxMinor, 0);
    const previous = await db.creditNote.aggregate({ where: { orderId: order.id }, _sum: { taxMinor: true } });
    const proportional = goodsTotal > 0 ? Math.round((Math.min(refund.amountMinor, goodsTotal) * goodsTax) / goodsTotal) : 0;
    const taxMinor = Math.max(0, Math.min(proportional, goodsTax - (previous._sum.taxMinor ?? 0), refund.amountMinor));
    const [row] = await db.$queryRaw<Array<{ seq: bigint }>>`SELECT nextval('credit_note_number_seq') AS seq`;
    if (!row) throw new Error("credit note sequence returned no value");
    const issuedAt = refund.processedAt ?? new Date();
    try {
      note = await db.creditNote.create({
        data: {
          creditNoteNumber: `CN/${financialYear(issuedAt)}/${String(row.seq).padStart(6, "0")}`,
          orderId: order.id,
          refundId: refund.id,
          invoiceNumber: invoice.invoiceNumber,
          amountMinor: refund.amountMinor,
          taxMinor,
          issuedAt,
        },
      });
    } catch (error) {
      // Lost a race with a concurrent job: use the winner's note.
      note = await db.creditNote.findUnique({ where: { refundId } });
      if (!note) throw error;
    }
  }

  const filename = `${note.creditNoteNumber.replace(/\//g, "-")}.pdf`;
  if (note.storageKey) {
    const stored = await getObjectBytes(note.storageKey).catch(() => null);
    if (stored) return { creditNoteNumber: note.creditNoteNumber, filename, pdf: Buffer.from(stored) };
  }

  const { buyer: billedTo, supply } = buyer(order);
  const taxable = note.amountMinor - note.taxMinor;
  const half = Math.floor(note.taxMinor / 2);
  const effectiveRate = taxable > 0 ? Math.round((note.taxMinor / taxable) * 10_000) / 100 : 0;
  const hsnCodes = [...new Set(order.items.map(lineHsn).filter((code): code is string => Boolean(code)))];
  const payment = order.payments[0];
  const pdf = await render({
    kind: "credit-note",
    invoiceNumber: note.creditNoteNumber,
    invoiceDate: formatDate(note.issuedAt),
    orderNumber: order.orderNumber,
    orderDate: formatDate(order.placedAt ?? order.createdAt),
    reference: { invoiceNumber: note.invoiceNumber, invoiceDate: formatDate(order.invoiceGeneratedAt ?? order.placedAt ?? order.createdAt), reason: refund.reason },
    seller: seller(),
    buyer: billedTo,
    supply,
    lines: [
      {
        description: `Refund against invoice ${note.invoiceNumber}`,
        sku: "",
        hsn: hsnCodes.join(", ") || null,
        quantity: 1,
        unitPrice: amount(note.amountMinor),
        taxableValue: amount(taxable),
        ratePercent: `${effectiveRate}%`,
        tax: amount(note.taxMinor),
        total: amount(note.amountMinor),
        serials: [],
      },
    ],
    totals: {
      taxable: inr(taxable),
      cgst: supply === "intra" ? inr(half) : null,
      sgst: supply === "intra" ? inr(note.taxMinor - half) : null,
      igst: supply === "inter" ? inr(note.taxMinor) : null,
      shipping: null,
      discount: null,
      total: inr(note.amountMinor),
      totalInWords: amountInWords(note.amountMinor),
    },
    payment: { provider: providerName(payment?.provider ?? refund.provider), reference: refund.providerRefundId, paidAt: refund.processedAt ? formatDate(refund.processedAt) : null },
  });
  const key = `invoices/${order.orderNumber}/${filename}`;
  try {
    await putObject({ key, body: pdf, contentType: "application/pdf", cacheControl: "private, no-store" });
    await db.creditNote.update({ where: { id: note.id }, data: { storageKey: key } });
  } catch (error) {
    log.error({ err: error, refundId }, "failed to store credit note PDF");
  }
  return { creditNoteNumber: note.creditNoteNumber, filename, pdf };
}

/** Successful refunds that still lack a credit note (enqueue failures, older refunds). */
export async function refundsMissingCreditNotes(limit = 100): Promise<string[]> {
  const rows = await db.refund.findMany({
    where: { status: "SUCCEEDED", creditNote: null, order: { placedAt: { not: null } } },
    select: { id: true },
    take: limit,
    orderBy: { processedAt: "asc" },
  });
  return rows.map((row) => row.id);
}
