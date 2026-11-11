-- =============================================================================
-- Integrity rules Prisma cannot express in schema.prisma.
-- These are the database's last line of defence: application bugs fail loudly here
-- instead of silently corrupting stock, money or audit history.
-- NOTE for future `prisma migrate dev` runs: review generated SQL and never accept a
-- DROP of the indexes / triggers defined below.
-- =============================================================================

-- ---- Inventory: zero-oversell invariants ---------------------------------------------
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_quantities_nonnegative"
    CHECK ("quantityOnHand" >= 0 AND "quantityReserved" >= 0 AND "quantityAvailable" >= 0 AND "lowStockThreshold" >= 0),
  ADD CONSTRAINT "InventoryItem_available_consistent"
    CHECK ("quantityAvailable" = "quantityOnHand" - "quantityReserved");

ALTER TABLE "StockReservation"
  ADD CONSTRAINT "StockReservation_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);

-- ---- Money ------------------------------------------------------------------------------
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_prices_valid"
    CHECK ("priceMinor" >= 0
       AND ("compareAtPriceMinor" IS NULL OR "compareAtPriceMinor" >= "priceMinor")
       AND ("costPriceMinor" IS NULL OR "costPriceMinor" >= 0));

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_nonnegative"
    CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "giftCardMinor" >= 0
       AND "taxMinor" >= 0 AND "shippingMinor" >= 0 AND "totalMinor" >= 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_values_valid"
    CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0
       AND "lineTotalMinor" >= 0 AND "refundedQuantity" BETWEEN 0 AND "quantity"
       AND "taxRateBps" BETWEEN 0 AND 10000);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amounts_valid"
    CHECK ("amountMinor" > 0 AND "amountRefundedMinor" BETWEEN 0 AND "amountMinor");

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountMinor" > 0);

ALTER TABLE "GiftCard"
  ADD CONSTRAINT "GiftCard_balance_valid" CHECK ("balanceMinor" >= 0 AND "balanceMinor" <= "initialBalanceMinor");

ALTER TABLE "ShippingMethod"
  ADD CONSTRAINT "ShippingMethod_values_valid"
    CHECK ("priceMinor" >= 0 AND ("freeAboveMinor" IS NULL OR "freeAboveMinor" >= 0)
       AND "minDays" >= 0 AND "maxDays" >= "minDays");

ALTER TABLE "Category"
  ADD CONSTRAINT "Category_tax_rate_range" CHECK ("taxRateBps" BETWEEN 0 AND 10000);

-- ---- Promotions -------------------------------------------------------------------------
ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_discount_shape"
    CHECK (("discountType" = 'PERCENTAGE' AND "percentOffBps" BETWEEN 1 AND 10000 AND "amountOffMinor" IS NULL)
        OR ("discountType" = 'FLAT' AND "amountOffMinor" > 0 AND "percentOffBps" IS NULL)),
  ADD CONSTRAINT "Coupon_limits_valid"
    CHECK ("timesRedeemed" >= 0 AND "minCartValueMinor" >= 0
       AND ("usageLimitTotal" IS NULL OR "usageLimitTotal" > 0)
       AND ("usageLimitPerUser" IS NULL OR "usageLimitPerUser" > 0)
       AND ("expiresAt" IS NULL OR "expiresAt" > "startsAt"));

ALTER TABLE "CouponRedemption"
  ADD CONSTRAINT "CouponRedemption_discount_nonnegative" CHECK ("discountMinor" >= 0);

-- ---- Reviews & auth ---------------------------------------------------------------------
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "OtpCode"
  ADD CONSTRAINT "OtpCode_attempts_valid" CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

-- ---- Partial unique indexes -------------------------------------------------------------
CREATE UNIQUE INDEX "Address_one_default_per_user" ON "Address" ("userId") WHERE "isDefault";
CREATE UNIQUE INDEX "ProductVariant_one_default_per_product" ON "ProductVariant" ("productId") WHERE "isDefault" AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "ProductImage_one_primary_per_product" ON "ProductImage" ("productId") WHERE "isPrimary";
-- At most one captured payment per order: a second capture can never be recorded as revenue.
CREATE UNIQUE INDEX "Payment_one_settled_per_order" ON "Payment" ("orderId")
  WHERE "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');
-- Sweeper / expiry lookups.
CREATE INDEX "StockReservation_active_expiry_idx" ON "StockReservation" ("expiresAt") WHERE "status" = 'ACTIVE';

-- ---- Vector search (pgvector HNSW, cosine distance) ---------------------------------------
CREATE INDEX "Product_embedding_hnsw_idx" ON "Product" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);

-- ---- Append-only audit tables ------------------------------------------------------------
CREATE OR REPLACE FUNCTION collab_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "AdminAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION collab_reject_mutation();

CREATE TRIGGER "StockMovementLog_append_only"
  BEFORE UPDATE OR DELETE ON "StockMovementLog"
  FOR EACH ROW EXECUTE FUNCTION collab_reject_mutation();
