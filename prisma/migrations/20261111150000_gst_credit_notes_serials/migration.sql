-- GST overrides per product, B2B GSTIN on orders, device serial / IMEI numbers, GST credit notes.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerGstin" VARCHAR(15);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "gstRateBps" INTEGER,
ADD COLUMN     "hsnCode" VARCHAR(10);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" VARCHAR(32) NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "invoiceNumber" VARCHAR(32) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "storageKey" VARCHAR(512),
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_refundId_key" ON "CreditNote"("refundId");

-- CreateIndex
CREATE INDEX "CreditNote_orderId_idx" ON "CreditNote"("orderId");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS "credit_note_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_gst_rate_range" CHECK ("gstRateBps" IS NULL OR "gstRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_customer_gstin_format" CHECK ("customerGstin" IS NULL OR "customerGstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
ALTER TABLE "CreditNote"
  ADD CONSTRAINT "CreditNote_amounts_valid" CHECK ("amountMinor" > 0 AND "taxMinor" >= 0 AND "taxMinor" <= "amountMinor");

