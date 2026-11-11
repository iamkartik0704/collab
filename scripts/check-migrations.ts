import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prisma cannot represent pgvector HNSW indexes, partial indexes, CHECK constraints or triggers,
 * so `prisma migrate dev` may generate SQL that silently drops them. This guard fails if any
 * migration after the one that created a protected object drops it.
 * Runs automatically in `npm run db:migrate` and in CI.
 */

const PROTECTED = [
  "Product_embedding_hnsw_idx",
  "KnowledgeChunk_embedding_hnsw_idx",
  "Address_one_default_per_user",
  "ProductVariant_one_default_per_product",
  "ProductImage_one_primary_per_product",
  "Payment_one_settled_per_order",
  "StockReservation_active_expiry_idx",
  "AdminAuditLog_append_only",
  "StockMovementLog_append_only",
  "InventoryItem_quantities_nonnegative",
  "InventoryItem_available_consistent",
  "collab_reject_mutation",
  "Order_orderNumber_trgm_idx",
  "ProductVariant_sku_trgm_idx",
  "AdminAuditLog_createdAt_id_idx",
  "Product_gst_rate_range",
  "Order_customer_gstin_format",
  "CreditNote_amounts_valid",
];

const migrationsDir = join(process.cwd(), "prisma", "migrations");
const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const violations: string[] = [];
for (const migration of migrations) {
  const sql = readFileSync(join(migrationsDir, migration, "migration.sql"), "utf8");
  for (const name of PROTECTED) {
    const dropPattern = new RegExp(`DROP\\s+(INDEX|TRIGGER|CONSTRAINT|FUNCTION)\\s+(IF\\s+EXISTS\\s+)?"?(public"?\\.)?"?${name}\\b`, "i");
    if (dropPattern.test(sql)) {
      violations.push(`${migration}: drops protected object "${name}"`);
    }
  }
}

if (violations.length > 0) {
  console.error("Migration guard failed. Remove these statements from the generated migration:\n  " + violations.join("\n  "));
  process.exit(1);
}
console.log(`Migration guard passed (${migrations.length} migrations, ${PROTECTED.length} protected objects).`);
