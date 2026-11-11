import type * as ReactPdf from "@react-pdf/renderer";
import type { ReactElement } from "react";

/**
 * GST tax invoice and GST credit note (India). Rendered server-side with @react-pdf/renderer. Uses the built-in
 * Helvetica, which has no ₹ glyph, so amounts are printed as "INR 1,234.00".
 *
 * The renderer module is passed in rather than imported: it ships ESM-only subpaths, so it is
 * always loaded with a dynamic import() (works in Next.js and in the tsx-run worker alike).
 */
export type ReactPdfModule = typeof ReactPdf;

export interface InvoiceLine {
  description: string;
  sku: string;
  hsn: string | null;
  quantity: number;
  unitPrice: string;
  taxableValue: string;
  ratePercent: string;
  tax: string;
  total: string;
  /** Device serial / IMEI numbers recorded at packing. */
  serials: string[];
}

export interface InvoiceData {
  /** "invoice" = tax invoice; "credit-note" = GST credit note against `reference`. */
  kind: "invoice" | "credit-note";
  /** Document number (invoice number or credit note number). */
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  orderDate: string;
  /** Credit notes: the original tax invoice being adjusted, and why. */
  reference: { invoiceNumber: string; invoiceDate: string; reason: string } | null;
  seller: {
    name: string;
    address: string;
    gstin: string | null;
    state: string;
  };
  buyer: {
    name: string;
    lines: string[];
    state: string | null;
    email: string | null;
    /** B2B buyers. */
    gstin: string | null;
  };
  /** "intra" = CGST + SGST (same state), "inter" = IGST. */
  supply: "intra" | "inter";
  lines: InvoiceLine[];
  totals: {
    taxable: string;
    cgst: string | null;
    sgst: string | null;
    igst: string | null;
    shipping: string | null;
    discount: string | null;
    total: string;
    totalInWords: string;
  };
  payment: {
    provider: string;
    reference: string | null;
    paidAt: string | null;
  };
}

const LABELS = {
  invoice: { title: "TAX INVOICE", total: "Invoice total", footer: "This is a computer-generated invoice and does not require a signature." },
  "credit-note": { title: "CREDIT NOTE", total: "Credit note total", footer: "This is a computer-generated credit note issued under section 34 of the CGST Act and does not require a signature." },
} as const;

/** Builds the invoice element with the given react-pdf module. */
export function createInvoiceDocument(
  pdf: ReactPdfModule,
  data: InvoiceData,
): ReactElement<ReactPdf.DocumentProps> {
  const { Document, Page, StyleSheet, Text, View } = pdf;
  const InvoiceDocument = buildInvoiceComponent();
  return (
    <InvoiceDocument data={data} />
  ) as unknown as ReactElement<ReactPdf.DocumentProps>;

  function buildInvoiceComponent() {
    const s = StyleSheet.create({
      page: {
        padding: 36,
        fontSize: 9,
        fontFamily: "Helvetica",
        color: "#111111",
      },
      row: { flexDirection: "row" },
      between: { flexDirection: "row", justifyContent: "space-between" },
      brand: { fontSize: 18, fontFamily: "Helvetica-Bold" },
      title: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
      muted: { color: "#5f6368" },
      bold: { fontFamily: "Helvetica-Bold" },
      box: {
        borderWidth: 1,
        borderColor: "#dddddd",
        borderRadius: 4,
        padding: 10,
        flexGrow: 1,
        flexBasis: 0,
      },
      th: {
        fontFamily: "Helvetica-Bold",
        backgroundColor: "#f4f4f4",
        paddingVertical: 5,
        paddingHorizontal: 4,
      },
      td: {
        paddingVertical: 5,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: "#eeeeee",
      },
      right: { textAlign: "right" },
    });

    const COLS = [
      { key: "description", label: "Item", flex: 3.2 },
      { key: "hsn", label: "HSN", flex: 0.8 },
      { key: "quantity", label: "Qty", flex: 0.5, right: true },
      { key: "unitPrice", label: "Unit price", flex: 1.2, right: true },
      { key: "taxableValue", label: "Taxable value", flex: 1.3, right: true },
      { key: "ratePercent", label: "GST %", flex: 0.7, right: true },
      { key: "tax", label: "GST", flex: 1.1, right: true },
      { key: "total", label: "Total (INR)", flex: 1.3, right: true },
    ] as const;

    function Total({
      label,
      value,
      strong = false,
    }: {
      label: string;
      value: string;
      strong?: boolean;
    }) {
      return (
        <View style={[s.between, { paddingVertical: 2 }]}>
          <Text style={strong ? s.bold : s.muted}>{label}</Text>
          <Text style={strong ? s.bold : undefined}>{value}</Text>
        </View>
      );
    }

    return function InvoiceDocument({ data }: { data: InvoiceData }) {
      return (
        <Document
          title={`${data.kind === "invoice" ? "Invoice" : "Credit note"} ${data.invoiceNumber}`}
          author={data.seller.name}
          subject={`Order ${data.orderNumber}`}
        >
          <Page size="A4" style={s.page}>
            <View style={[s.between, { marginBottom: 18 }]}>
              <View>
                <Text style={s.brand}>Collab</Text>
                <Text style={[s.muted, { marginTop: 2 }]}>
                  {data.seller.name}
                </Text>
              </View>
              <View>
                <Text style={s.title}>{LABELS[data.kind].title}</Text>
                <Text style={[s.right, { marginTop: 4 }]}>
                  <Text style={s.bold}>{data.invoiceNumber}</Text>
                </Text>
                <Text style={[s.right, s.muted]}>Date: {data.invoiceDate}</Text>
                <Text style={[s.right, s.muted]}>
                  Order {data.orderNumber} · {data.orderDate}
                </Text>
                {data.reference && (
                  <Text style={[s.right, s.bold, { marginTop: 2 }]}>
                    Against invoice {data.reference.invoiceNumber} dated {data.reference.invoiceDate}
                  </Text>
                )}
              </View>
            </View>

            <View style={[s.row, { gap: 10, marginBottom: 16 }]}>
              <View style={s.box}>
                <Text style={[s.bold, { marginBottom: 4 }]}>Sold by</Text>
                <Text>{data.seller.name}</Text>
                <Text style={s.muted}>{data.seller.address}</Text>
                <Text style={{ marginTop: 4 }}>
                  GSTIN: {data.seller.gstin ?? "Applied for"}
                </Text>
                <Text style={s.muted}>State: {data.seller.state}</Text>
              </View>
              <View style={s.box}>
                <Text style={[s.bold, { marginBottom: 4 }]}>
                  Billed / shipped to
                </Text>
                <Text>{data.buyer.name}</Text>
                {data.buyer.lines.map((line, index) => (
                  <Text key={index} style={s.muted}>
                    {line}
                  </Text>
                ))}
                {data.buyer.email && (
                  <Text style={[s.muted, { marginTop: 4 }]}>
                    {data.buyer.email}
                  </Text>
                )}
                <Text style={s.muted}>
                  Place of supply: {data.buyer.state ?? "—"}
                </Text>
                {data.buyer.gstin && (
                  <Text style={[s.bold, { marginTop: 4 }]}>GSTIN: {data.buyer.gstin}</Text>
                )}
              </View>
            </View>

            <View style={s.row}>
              {COLS.map((col) => (
                <Text
                  key={col.key}
                  style={[
                    s.th,
                    { flex: col.flex },
                    "right" in col && col.right ? s.right : {},
                  ]}
                >
                  {col.label}
                </Text>
              ))}
            </View>
            {data.lines.map((line, index) => (
              <View key={index} style={s.row} wrap={false}>
                {COLS.map((col) => (
                  <View key={col.key} style={[s.td, { flex: col.flex }]}>
                    <Text
                      style={"right" in col && col.right ? s.right : undefined}
                    >
                      {col.key === "hsn"
                        ? (line.hsn ?? "—")
                        : String(line[col.key])}
                    </Text>
                    {col.key === "description" && line.sku && (
                      <Text style={[s.muted, { fontSize: 7.5 }]}>
                        SKU {line.sku}
                      </Text>
                    )}
                    {col.key === "description" && line.serials.length > 0 && (
                      <Text style={[s.muted, { fontSize: 7.5 }]}>
                        S/N / IMEI: {line.serials.join(", ")}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))}

            <View style={[s.row, { marginTop: 14 }]}>
              <View style={{ flex: 1.4, paddingRight: 20 }}>
                <Text style={s.muted}>Amount in words</Text>
                <Text style={[s.bold, { marginTop: 2 }]}>
                  {data.totals.totalInWords}
                </Text>
                {data.reference && (
                  <Text style={[s.muted, { marginTop: 10 }]}>Reason: {data.reference.reason}</Text>
                )}
                <Text style={[s.muted, { marginTop: 10 }]}>
                  {data.kind === "invoice" ? "Paid via" : "Refunded to the original payment method via"} {data.payment.provider}
                  {data.payment.reference
                    ? ` · ref ${data.payment.reference}`
                    : ""}
                  {data.payment.paidAt ? ` · ${data.payment.paidAt}` : ""}
                </Text>
                <Text style={[s.muted, { marginTop: 4 }]}>
                  Prices are inclusive of GST. Tax is not payable on reverse
                  charge.
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Total label="Taxable value" value={data.totals.taxable} />
                {data.supply === "intra" ? (
                  <>
                    <Total
                      label="CGST"
                      value={data.totals.cgst ?? "INR 0.00"}
                    />
                    <Total
                      label="SGST"
                      value={data.totals.sgst ?? "INR 0.00"}
                    />
                  </>
                ) : (
                  <Total label="IGST" value={data.totals.igst ?? "INR 0.00"} />
                )}
                {data.totals.discount && (
                  <Total
                    label="Discount (incl.)"
                    value={`- ${data.totals.discount}`}
                  />
                )}
                {data.totals.shipping !== null && <Total label="Shipping" value={data.totals.shipping} />}
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "#111111",
                    marginTop: 4,
                    paddingTop: 4,
                  }}
                >
                  <Total
                    label={LABELS[data.kind].total}
                    value={data.totals.total}
                    strong
                  />
                </View>
              </View>
            </View>

            <Text
              style={[
                s.muted,
                {
                  position: "absolute",
                  bottom: 28,
                  left: 36,
                  right: 36,
                  textAlign: "center",
                  fontSize: 7.5,
                },
              ]}
              fixed
            >
              {LABELS[data.kind].footer} {data.seller.name} · {data.seller.address}
            </Text>
          </Page>
        </Document>
      );
    };
  }
}
