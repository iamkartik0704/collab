-- A refund moves item quantities and (optionally) stock inside the transaction that creates the
-- PENDING row, before the provider call happens. When the provider later reports FAILED, the
-- reconciliation needs to know exactly what to give back, so record it on the refund itself.
ALTER TABLE "Refund" ADD COLUMN "lines" JSONB,
ADD COLUMN "restocked" BOOLEAN NOT NULL DEFAULT false;
