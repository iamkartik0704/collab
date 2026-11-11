import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/** Direct database access for fixtures (bypasses PgBouncer). Tests never assert via the DB alone. */

const envFile = path.resolve(__dirname, "../../../.env");
if (existsSync(envFile) && !process.env.AUTH_SECRET) process.loadEnvFile(envFile);

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } } });
  return client;
}

export async function closeDb(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

export const STAFF_EMAILS = {
  admin: process.env.SEED_ADMIN_EMAIL ?? "admin@collab.example.com",
  inventory: process.env.SEED_INVENTORY_EMAIL ?? "inventory@collab.example.com",
  support: process.env.SEED_SUPPORT_EMAIL ?? "support@collab.example.com",
} as const;
export type StaffRole = keyof typeof STAFF_EMAILS;

/** Dedicated storefront customer for e2e flows (created by global setup). */
export const E2E_CUSTOMER_EMAIL = "e2e.customer@example.com";

/** Marks an order delivered just now (as the courier webhook / admin would). */
export async function markDelivered(orderNumber: string): Promise<void> {
  await db().order.update({ where: { orderNumber }, data: { status: "DELIVERED", shippedAt: new Date(), deliveredAt: new Date() } });
}

/**
 * A fresh paid order in PLACED status (as if the payment webhook just confirmed it), so the
 * fulfilment tests never depend on how many seeded orders are still unfulfilled.
 */
export async function createPaidOrder(tag: string): Promise<{ orderNumber: string; sku: string }> {
  const prisma = db();
  const customer = await prisma.user.findUniqueOrThrow({ where: { email: E2E_CUSTOMER_EMAIL } });
  const shipping = await prisma.shippingMethod.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { isActive: true, deletedAt: null, product: { status: "ACTIVE" } },
    include: { product: { include: { category: true } } },
    orderBy: { sku: "asc" },
  });
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const orderNumber = `CLB-E2E${suffix}`.slice(0, 24);
  const total = variant.priceMinor * 2;
  const tax = Math.round((total * variant.product.category.taxRateBps) / (10_000 + variant.product.category.taxRateBps));
  const now = new Date();
  await prisma.order.create({
    data: {
      orderNumber,
      userId: customer.id,
      status: "PLACED",
      subtotalMinor: total,
      taxMinor: tax,
      shippingMinor: 0,
      totalMinor: total,
      shippingAddress: { fullName: customer.name ?? "E2E Customer", phone: "+919800000000", line1: "1 Test Street", city: "Bengaluru", state: "Karnataka", postalCode: "560001", countryCode: "IN" },
      shippingMethodId: shipping.id,
      shippingMethodName: shipping.name,
      idempotencyKey: `e2e-${tag}-${suffix}`,
      placedAt: now,
      items: {
        create: {
          productId: variant.productId,
          variantId: variant.id,
          productName: variant.product.name,
          variantTitle: variant.title,
          sku: variant.sku,
          hsnCode: variant.product.hsnCode ?? variant.product.category.hsnCode,
          unitPriceMinor: variant.priceMinor,
          quantity: 2,
          taxRateBps: variant.product.category.taxRateBps,
          taxMinor: tax,
          lineTotalMinor: total,
        },
      },
      statusHistory: { create: [{ toStatus: "PENDING_PAYMENT" }, { fromStatus: "PENDING_PAYMENT", toStatus: "PLACED", note: "payment captured (e2e)" }] },
      payments: {
        create: {
          provider: "RAZORPAY",
          method: "UPI",
          status: "SUCCEEDED",
          providerOrderId: `order_e2e_${suffix.toLowerCase()}`,
          providerPaymentId: `pay_e2e_${suffix.toLowerCase()}`,
          amountMinor: total,
          currency: "INR",
          idempotencyKey: `e2e-pay-${tag}-${suffix}`,
          capturedAt: now,
        },
      },
    },
  });
  return { orderNumber, sku: variant.sku };
}
