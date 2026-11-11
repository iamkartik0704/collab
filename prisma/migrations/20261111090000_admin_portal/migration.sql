-- Phase 4 (admin portal): restocks caused by cancelling a paid order before dispatch get their
-- own movement type so the inventory audit trail distinguishes them from customer returns.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLATION';

-- Admin list pages: order search by number prefix and product search by SKU.
CREATE INDEX IF NOT EXISTS "Order_orderNumber_trgm_idx" ON "Order" USING gin ("orderNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING gin ("sku" gin_trgm_ops);
-- Audit-log viewer pagination (newest first, stable tiebreak).
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_id_idx" ON "AdminAuditLog" ("createdAt" DESC, id DESC);
