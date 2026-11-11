-- Phase 5: support-agent transcript replay + GST invoice numbering.

-- Raw Messages API content for each chat turn (thinking / tool_use / tool_result blocks).
ALTER TABLE "ChatMessage" ADD COLUMN "apiContent" JSONB;

-- Gap-tolerant, concurrency-safe invoice counter (Order.invoiceNumber = INV/<FY>/<seq>).
-- Not modelled in schema.prisma; Prisma ignores standalone sequences.
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Inbox: escalated / taken-over sessions by recency.
CREATE INDEX IF NOT EXISTS "SupportTicket_status_createdAt_idx" ON "SupportTicket" ("status", "createdAt" DESC);
