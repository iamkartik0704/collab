import type { OrderStatus, PaymentMethodType, PaymentProvider, PaymentStatus, Prisma, PrismaClient, Role } from "@prisma/client";

/**
 * Staff accounts + ~90 days of demo order history for the admin dashboard.
 *
 * Staff sign in like everyone else (email OTP or Google); the seed only creates the user rows
 * with their roles. Override the addresses with SEED_ADMIN_EMAIL / SEED_INVENTORY_EMAIL /
 * SEED_SUPPORT_EMAIL. Demo orders are deterministic (seeded PRNG) and created once: re-running
 * the seed never duplicates them. They do not move live stock: they are history, not demand.
 */

export const STAFF: ReadonlyArray<{ role: Role; name: string; email: string }> = [
  { role: "SUPER_ADMIN", name: "Store Admin", email: process.env.SEED_ADMIN_EMAIL ?? "admin@collab.example.com" },
  { role: "INVENTORY_MANAGER", name: "Inventory Manager", email: process.env.SEED_INVENTORY_EMAIL ?? "inventory@collab.example.com" },
  { role: "SUPPORT_AGENT", name: "Support Agent", email: process.env.SEED_SUPPORT_EMAIL ?? "support@collab.example.com" },
];

export async function seedStaff(prisma: PrismaClient): Promise<void> {
  for (const member of STAFF) {
    const email = member.email.trim().toLowerCase();
    await prisma.user.upsert({
      where: { email },
      create: { email, name: member.name, role: member.role, emailVerified: new Date() },
      // Re-running restores the role (e.g. after an accidental demotion in a dev database).
      update: { role: member.role, isActive: true },
    });
  }
}

const DEMO_CUSTOMERS = [
  "Aarav Sharma", "Priya Iyer", "Rohan Mehta", "Ananya Gupta", "Vikram Nair", "Meera Kapoor",
  "Kabir Singh", "Isha Reddy", "Arjun Menon", "Diya Banerjee", "Siddharth Rao", "Neha Joshi",
  "Aditya Kulkarni", "Kavya Pillai", "Rahul Verma", "Sneha Desai", "Karan Malhotra", "Tara Chatterjee",
];

const CITIES = [
  { city: "Bengaluru", state: "Karnataka", postalCode: "560001" },
  { city: "Mumbai", state: "Maharashtra", postalCode: "400001" },
  { city: "New Delhi", state: "Delhi", postalCode: "110001" },
  { city: "Chennai", state: "Tamil Nadu", postalCode: "600001" },
  { city: "Hyderabad", state: "Telangana", postalCode: "500001" },
  { city: "Pune", state: "Maharashtra", postalCode: "411001" },
  { city: "Kolkata", state: "West Bengal", postalCode: "700001" },
  { city: "Ahmedabad", state: "Gujarat", postalCode: "380001" },
];

const CARRIERS = [
  { carrierName: "Delhivery", url: "https://www.delhivery.com/track/package/" },
  { carrierName: "Blue Dart", url: "https://www.bluedart.com/tracking/" },
  { carrierName: "Ekart", url: "https://ekartlogistics.com/shipmenttrack/" },
];

const DEMO_ORDER_COUNT = 160;
const HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;

/** mulberry32: small deterministic PRNG so the demo data is identical on every machine. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Status for an order placed `ageDays` ago (older orders have run their course). */
function pickStatus(ageDays: number, roll: number): OrderStatus {
  if (ageDays >= 10) {
    if (roll < 0.04) return "PAYMENT_FAILED";
    if (roll < 0.1) return "CANCELLED";
    if (roll < 0.15) return "RETURNED";
    return "DELIVERED";
  }
  if (ageDays >= 4) {
    if (roll < 0.03) return "PAYMENT_FAILED";
    if (roll < 0.06) return "CANCELLED";
    if (roll < 0.3) return "SHIPPED";
    if (roll < 0.45) return "OUT_FOR_DELIVERY";
    return "DELIVERED";
  }
  if (roll < 0.03) return "PAYMENT_FAILED";
  if (roll < 0.3) return "PLACED";
  if (roll < 0.55) return "CONFIRMED";
  if (roll < 0.75) return "PACKED";
  return "SHIPPED";
}

/** The fulfilment path that leads to each final status (after payment). */
const PATH: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: [],
  PAYMENT_FAILED: [],
  PLACED: ["PLACED"],
  CONFIRMED: ["PLACED", "CONFIRMED"],
  PACKED: ["PLACED", "CONFIRMED", "PACKED"],
  SHIPPED: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED"],
  OUT_FOR_DELIVERY: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"],
  DELIVERED: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"],
  RETURNED: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"],
  CANCELLED: ["PLACED", "CONFIRMED", "CANCELLED"],
};

/** Hours after the payment at which each step happens. */
const STEP_HOURS: Partial<Record<OrderStatus, number>> = {
  PLACED: 0,
  CONFIRMED: 2,
  PACKED: 20,
  SHIPPED: 30,
  OUT_FOR_DELIVERY: 70,
  DELIVERED: 78,
  RETURNED: 200,
  CANCELLED: 6,
};

const TIMESTAMP_FIELD: Partial<Record<OrderStatus, keyof Prisma.OrderUncheckedCreateInput>> = {
  CONFIRMED: "confirmedAt",
  PACKED: "packedAt",
  SHIPPED: "shippedAt",
  OUT_FOR_DELIVERY: "outForDeliveryAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
};

export async function seedDemoOrders(prisma: PrismaClient): Promise<number> {
  if ((await prisma.order.count({ where: { idempotencyKey: { startsWith: "seed-demo-order-" } } })) > 0) return 0;

  const shipping = await prisma.shippingMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, deletedAt: null, product: { status: "ACTIVE", deletedAt: null } },
    select: {
      id: true,
      sku: true,
      title: true,
      priceMinor: true,
      compareAtPriceMinor: true,
      productId: true,
      product: { select: { name: true, category: { select: { taxRateBps: true, hsnCode: true } }, images: { where: { isPrimary: true }, take: 1, select: { storageKey: true } } } },
    },
    orderBy: { sku: "asc" },
  });
  if (variants.length === 0 || shipping.length === 0) return 0;
  const staff = await prisma.user.findFirst({ where: { role: "INVENTORY_MANAGER" }, select: { id: true } });

  const customers: Array<{ id: string; name: string }> = [];
  for (const name of DEMO_CUSTOMERS) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
    customers.push(await prisma.user.upsert({ where: { email }, create: { email, name, emailVerified: new Date() }, update: {}, select: { id: true, name: true } }).then((user) => ({ id: user.id, name: user.name ?? name })));
  }

  const random = prng(20261111);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const now = Date.now();
  // Bias towards recent days so the trend line rises.
  const ages = Array.from({ length: DEMO_ORDER_COUNT }, () => Math.floor(Math.pow(random(), 1.25) * HISTORY_DAYS)).sort((a, b) => b - a);

  let created = 0;
  for (const [index, ageDays] of ages.entries()) {
    const customer = pick(customers);
    const place = pick(CITIES);
    const method = random() < 0.75 ? shipping[0]! : pick(shipping);
    const status = pickStatus(ageDays, random());
    // 09:00-23:00 IST on that day.
    const startedAt = new Date(now - ageDays * DAY_MS - Math.floor(random() * 14 * 3_600_000));
    if (startedAt.getTime() > now - 3_600_000) startedAt.setTime(now - 3_600_000 - Math.floor(random() * 3_600_000));

    const lineCount = random() < 0.7 ? 1 : random() < 0.8 ? 2 : 3;
    const chosen = new Map<string, { variant: (typeof variants)[number]; quantity: number }>();
    while (chosen.size < lineCount) {
      const variant = pick(variants);
      if (!chosen.has(variant.id)) chosen.set(variant.id, { variant, quantity: random() < 0.85 ? 1 : 2 });
    }
    const lines = [...chosen.values()].map(({ variant, quantity }) => {
      const rate = variant.product.category.taxRateBps;
      const lineTotalMinor = variant.priceMinor * quantity;
      return {
        productId: variant.productId,
        variantId: variant.id,
        productName: variant.product.name,
        variantTitle: variant.title,
        sku: variant.sku,
        imageKey: variant.product.images[0]?.storageKey ?? null,
        hsnCode: variant.product.category.hsnCode,
        unitPriceMinor: variant.priceMinor,
        compareAtPriceMinor: variant.compareAtPriceMinor,
        quantity,
        taxRateBps: rate,
        // Prices are GST-inclusive: tax = total * rate / (1 + rate).
        taxMinor: Math.round((lineTotalMinor * rate) / (10_000 + rate)),
        lineTotalMinor,
      };
    });
    const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    const shippingMinor = method.freeAboveMinor !== null && subtotalMinor >= method.freeAboveMinor ? 0 : method.priceMinor;
    const totalMinor = subtotalMinor + shippingMinor;

    const paid = status !== "PAYMENT_FAILED";
    const path = PATH[status];
    const at = (step: OrderStatus) => new Date(startedAt.getTime() + 4 * 60_000 + (STEP_HOURS[step] ?? 0) * 3_600_000);
    const timestamps: Record<string, Date> = {};
    for (const step of path) {
      const field = TIMESTAMP_FIELD[step];
      if (field) timestamps[field] = at(step);
    }
    const shipped = path.includes("SHIPPED");
    const carrier = pick(CARRIERS);
    const trackingNumber = `${carrier.carrierName.slice(0, 2).toUpperCase()}${String(100_000_000 + Math.floor(random() * 899_999_999))}`;
    const provider: PaymentProvider = random() < 0.55 ? "RAZORPAY" : "STRIPE";
    const paymentMethod: PaymentMethodType = provider === "RAZORPAY" ? (random() < 0.7 ? "UPI" : "CARD") : "CARD";
    const refunded = status === "RETURNED" || status === "CANCELLED";
    const paymentStatus: PaymentStatus = !paid ? "FAILED" : refunded ? "REFUNDED" : "SUCCEEDED";
    const orderNumber = `CLB-DEMO${String(index + 1).padStart(5, "0")}`;
    const history: Array<{ fromStatus: OrderStatus | null; toStatus: OrderStatus; createdAt: Date; note: string | null; actorId: string | null }> = [
      { fromStatus: null, toStatus: "PENDING_PAYMENT", createdAt: startedAt, note: "checkout started", actorId: null },
    ];
    if (!paid) history.push({ fromStatus: "PENDING_PAYMENT", toStatus: "PAYMENT_FAILED", createdAt: new Date(startedAt.getTime() + 3 * 60_000), note: "card_declined", actorId: null });
    let previous: OrderStatus = "PENDING_PAYMENT";
    for (const step of path) {
      history.push({ fromStatus: previous, toStatus: step, createdAt: at(step), note: step === "PLACED" ? "payment captured" : null, actorId: step === "PLACED" ? null : (staff?.id ?? null) });
      previous = step;
    }

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: customer.id,
          status,
          subtotalMinor,
          taxMinor: lines.reduce((sum, line) => sum + line.taxMinor, 0),
          shippingMinor,
          totalMinor,
          shippingAddress: { type: "HOME", fullName: customer.name, phone: "+919800000000", line1: `${10 + (index % 90)}, MG Road`, line2: null, landmark: null, ...place, countryCode: "IN" },
          shippingMethodId: method.id,
          shippingMethodName: method.name,
          estimatedDeliveryAt: new Date(startedAt.getTime() + method.maxDays * DAY_MS),
          idempotencyKey: `seed-demo-order-${index}`,
          placedAt: paid ? at("PLACED") : null,
          cancelReason: status === "CANCELLED" ? "customer_requested" : status === "PAYMENT_FAILED" ? "payment_failed" : null,
          ...(shipped ? { carrierName: carrier.carrierName, trackingNumber, trackingUrl: `${carrier.url}${trackingNumber}` } : {}),
          ...timestamps,
          createdAt: startedAt,
          items: { create: lines.map((line) => ({ ...line, refundedQuantity: status === "RETURNED" ? line.quantity : 0, createdAt: startedAt })) },
          statusHistory: { create: history },
        },
        select: { id: true },
      });
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider,
          method: paymentMethod,
          status: paymentStatus,
          providerOrderId: `${provider === "STRIPE" ? "pi" : "order"}_demo_${orderNumber.toLowerCase()}`,
          providerPaymentId: paid ? `${provider === "STRIPE" ? "ch" : "pay"}_demo_${orderNumber.toLowerCase()}` : null,
          amountMinor: totalMinor,
          amountRefundedMinor: refunded ? totalMinor : 0,
          currency: "INR",
          idempotencyKey: `seed-demo-payment-${index}`,
          failureCode: paid ? null : "card_declined",
          failureMessage: paid ? null : "Your card was declined.",
          capturedAt: paid ? at("PLACED") : null,
          createdAt: startedAt,
        },
        select: { id: true },
      });
      if (refunded) {
        const processedAt = new Date(at(status).getTime() + 3_600_000);
        await tx.refund.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            provider,
            providerRefundId: `${provider === "STRIPE" ? "re" : "rfnd"}_demo_${orderNumber.toLowerCase()}`,
            amountMinor: totalMinor,
            status: "SUCCEEDED",
            reason: status === "RETURNED" ? "Customer return" : "Order cancelled before dispatch",
            idempotencyKey: `seed-demo-refund-${index}`,
            initiatedById: staff?.id ?? null,
            processedAt: processedAt.getTime() > now ? new Date(now) : processedAt,
            createdAt: at(status),
          },
        });
      }
    });
    created++;
  }

  // Daily rollups are derived data: drop them so the dashboard recomputes with the history.
  await prisma.dailyMetric.deleteMany({ where: { date: { gte: new Date(now - (HISTORY_DAYS * 2 + 2) * DAY_MS) } } });
  return created;
}
