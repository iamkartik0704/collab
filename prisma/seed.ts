import { type Prisma, PrismaClient } from "@prisma/client";
import { artPath, BRANDS, colorSlug, PRODUCTS, SPEC_TEMPLATES, type SeedProduct } from "./catalog-data";
import { seedDemoOrders, seedStaff, STAFF } from "./seed-demo";

/**
 * Reference + demo data. Idempotent (upserts by code / slug / SKU); stock is only set when an
 * inventory row is first created, so re-running never resets live stock.
 * Run: npm run db:seed   (artwork: npx tsx scripts/generate-product-art.ts)
 */
const prisma = new PrismaClient();

const SHIPPING_METHODS = [
  { code: "FREE_STANDARD", name: "Free Standard Delivery", description: "Regular shipment", speed: "STANDARD" as const, priceMinor: 9_900, freeAboveMinor: 99_900, minDays: 4, maxDays: 7, requiresSlot: false, sortOrder: 0 },
  { code: "EXPRESS_PRIORITY", name: "Express Priority Delivery", description: "Get your delivery as soon as possible", speed: "EXPRESS" as const, priceMinor: 29_900, freeAboveMinor: null, minDays: 1, maxDays: 2, requiresSlot: false, sortOrder: 1 },
  { code: "SCHEDULED", name: "Scheduled Delivery", description: "Pick a date when you want to get your delivery", speed: "SCHEDULED" as const, priceMinor: 19_900, freeAboveMinor: null, minDays: 1, maxDays: 14, requiresSlot: true, sortOrder: 2 },
];

const CATEGORIES = [
  { slug: "phones", name: "Phones", iconKey: "smartphone", hsnCode: "8517", sortOrder: 0 },
  { slug: "computers", name: "Computers", iconKey: "monitor", hsnCode: "8471", sortOrder: 1 },
  { slug: "smart-watches", name: "Smart Watches", iconKey: "watch", hsnCode: "8517", sortOrder: 2 },
  { slug: "cameras", name: "Cameras", iconKey: "camera", hsnCode: "8525", sortOrder: 3 },
  { slug: "headphones", name: "Headphones", iconKey: "headphones", hsnCode: "8518", sortOrder: 4 },
  { slug: "gaming", name: "Gaming", iconKey: "gamepad-2", hsnCode: "9504", sortOrder: 5 },
] as const;

const COUPONS = [
  { code: "WELCOME10", description: "10% off your first order (up to ₹2,000)", discountType: "PERCENTAGE" as const, percentOffBps: 1000, maxDiscountMinor: 2_000_00, usageLimitPerUser: 1, firstOrderOnly: true },
  { code: "AUDIO2000", description: "₹2,000 off headphones over ₹20,000", discountType: "FLAT" as const, amountOffMinor: 2_000_00, minCartValueMinor: 20_000_00, categorySlug: "headphones" },
  { code: "FESTIVE5", description: "5% off sitewide (up to ₹5,000)", discountType: "PERCENTAGE" as const, percentOffBps: 500, maxDiscountMinor: 5_000_00, usageLimitTotal: 1000 },
];

const CUSTOMERS = [
  { name: "Aarav Sharma", email: "aarav.sharma@example.com" },
  { name: "Priya Iyer", email: "priya.iyer@example.com" },
  { name: "Rohan Mehta", email: "rohan.mehta@example.com" },
  { name: "Ananya Gupta", email: "ananya.gupta@example.com" },
  { name: "Vikram Nair", email: "vikram.nair@example.com" },
  { name: "Meera Kapoor", email: "meera.kapoor@example.com" },
];

/** [productSlug, customerIndex, rating, title, body, verified] */
const REVIEWS: Array<[string, number, number, string, string, boolean]> = [
  ["iphone-14-pro", 0, 5, "Best camera I've used on a phone", "The 48MP main camera is incredible in daylight and the night mode shots are clean. Dynamic Island turned out to be genuinely useful for timers and deliveries. Battery easily lasts a full day.", true],
  ["iphone-14-pro", 1, 5, "Premium in every way", "Delivered in two days, sealed box, GST invoice included. The Deep Purple looks subtle and classy. ProMotion makes everything feel buttery smooth.", true],
  ["iphone-14-pro", 2, 4, "Great phone, heavy though", "Performance and display are top notch. It is noticeably heavier than my old phone, so I'd recommend a grippy case. Otherwise no complaints.", true],
  ["iphone-14-pro", 3, 5, "Smooth upgrade from iPhone 11", "Moving my data took minutes. Always-On display is handy without draining the battery. Collab support answered my warranty question on WhatsApp quickly.", false],
  ["iphone-14-pro", 4, 3, "Good, but charging is slow", "Everything is excellent except the charging speed compared to Android flagships. Buy a 20W adapter separately since there's none in the box.", true],
  ["airpods-max", 1, 5, "Noise cancellation is unreal", "Wore these on a 9-hour flight and barely heard the engines. Spatial audio for movies is a treat. The mesh headband is comfortable for hours.", true],
  ["airpods-max", 2, 4, "Sound is superb, case is odd", "Rich, detailed sound and great ANC. The Smart Case doesn't protect much, so I bought a hard case. Still my favourite headphones.", true],
  ["airpods-max", 5, 5, "Worth it for Apple users", "Seamless switching between my Mac and iPhone. Build quality feels luxurious. Got them on discount here which made the decision easy.", false],
  ["playstation-5", 3, 5, "Next-gen loading is magic", "Games load in seconds and the DualSense haptics are a revelation in Astro's Playroom. The slim model fits my TV unit perfectly.", true],
  ["playstation-5", 4, 5, "Kids love it", "Easy setup, quiet even after long sessions. Packaging was excellent and it arrived well before the estimated date.", true],
  ["playstation-5", 0, 4, "Fantastic console", "Brilliant performance at 4K. Storage fills up quickly with big games, so plan for an extra SSD.", false],
  ["macbook-air-15", 2, 5, "The perfect work laptop", "Silent, fast and the battery lasts two working days for me. The 15-inch screen is great for spreadsheets without being heavy.", true],
  ["macbook-air-15", 5, 4, "Great value for the size", "Very happy with the Midnight colour, although it does show fingerprints. 8GB is fine for office work; go 16GB if you edit video.", true],
  ["samsung-galaxy-s24-ultra", 1, 5, "Zoom camera is a game changer", "The 5x zoom is sharp enough for concerts. Galaxy AI translation helped me on a trip to Japan. The titanium frame feels solid.", true],
  ["samsung-galaxy-s24-ultra", 4, 4, "Big but brilliant", "Display is the best I've seen and the S Pen is handy for notes. It's a large phone, so one-handed use is hard.", false],
  ["sony-wh-1000xm5", 3, 5, "Comfortable all day", "Lighter than my previous XM4s with even better call quality. LDAC sounds great with my Android phone.", true],
  ["sony-wh-1000xm5", 5, 4, "Excellent ANC", "Noise cancellation is excellent on the metro. Wish they still folded down like the older model.", true],
  ["apple-watch-ultra-2", 0, 5, "Built for adventures", "Used it on a Himalayan trek — dual-frequency GPS was accurate and the battery lasted almost two days. The screen is readable in harsh sunlight.", true],
  ["airpods-pro-2", 2, 5, "Best earbuds for iPhone", "Adaptive audio is clever and the fit is secure for running. USB-C case is a welcome change.", true],
  ["airpods-pro-2", 4, 5, "Huge upgrade", "ANC is twice as good as my first-gen Pros. Find My speaker in the case has already saved me once.", true],
  ["airpods-pro-2", 1, 4, "Great but pricey", "Sound and ANC are excellent. Tips could be a little softer, but the included XS size helped.", false],
  ["sony-alpha-7-iv", 5, 5, "A true hybrid camera", "Eye AF tracks birds in flight reliably and 10-bit video grades nicely. The menu system is finally sensible.", true],
  ["dualsense-controller", 3, 4, "Adaptive triggers are fun", "Feels premium and the haptics are fantastic. Battery life could be better for long sessions.", true],
];

function sku(product: SeedProduct, variant: SeedProduct["variants"][number]): string {
  return [product.slug, colorSlug(variant.color), variant.storageGb ? `${variant.storageGb}g` : "", variant.ramGb ? `r${variant.ramGb}` : ""]
    .filter(Boolean)
    .join("-")
    .toUpperCase()
    .slice(0, 64);
}

async function seedReference(): Promise<void> {
  for (const method of SHIPPING_METHODS) {
    await prisma.shippingMethod.upsert({ where: { code: method.code }, create: method, update: method });
  }
  for (const category of CATEGORIES) {
    const data = { ...category, taxRateBps: 1800, specTemplate: SPEC_TEMPLATES[category.slug] as unknown as Prisma.InputJsonValue };
    await prisma.category.upsert({ where: { slug: category.slug }, create: data, update: data });
  }
  for (const [slug, name] of Object.entries(BRANDS)) {
    await prisma.brand.upsert({ where: { slug }, create: { slug, name }, update: { name } });
  }
}

async function seedCatalog(): Promise<void> {
  const categories = new Map((await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  const brands = new Map((await prisma.brand.findMany({ select: { id: true, slug: true } })).map((b) => [b.slug, b.id]));

  for (const product of PRODUCTS) {
    const data = {
      name: product.name,
      summary: product.summary,
      description: product.description,
      brandId: brands.get(product.brand)!,
      categoryId: categories.get(product.category)!,
      status: "ACTIVE" as const,
      specs: product.specs as Prisma.InputJsonValue,
      highlightSpecs: product.highlights as unknown as Prisma.InputJsonValue,
      isFeatured: product.featured ?? false,
      warrantyMonths: product.warrantyMonths ?? 12,
      publishedAt: new Date(Date.now() - product.daysAgo * 86_400_000),
    };
    const saved = await prisma.product.upsert({
      where: { slug: product.slug },
      create: { ...data, slug: product.slug, salesCount: product.sales },
      update: data,
      select: { id: true },
    });

    // Default-variant flag: clear first (partial unique index allows one per product).
    await prisma.productVariant.updateMany({ where: { productId: saved.id }, data: { isDefault: false } });
    const variantIds: string[] = [];
    for (const [index, variant] of product.variants.entries()) {
      const storage = variant.storageGb ? (variant.storageGb >= 1024 ? `${variant.storageGb / 1024}TB` : `${variant.storageGb}GB`) : null;
      const title = [variant.color, storage, variant.ramGb ? `${variant.ramGb}GB RAM` : null].filter(Boolean).join(" / ");
      const variantData = {
        productId: saved.id,
        title,
        color: variant.color,
        colorHex: variant.hex,
        storageGb: variant.storageGb ?? null,
        ramGb: variant.ramGb ?? null,
        priceMinor: variant.price * 100,
        compareAtPriceMinor: variant.mrp ? variant.mrp * 100 : null,
        isDefault: index === 0,
        isActive: true,
      };
      const savedVariant = await prisma.productVariant.upsert({
        where: { sku: sku(product, variant) },
        create: { ...variantData, sku: sku(product, variant) },
        update: variantData,
        select: { id: true },
      });
      variantIds.push(savedVariant.id);
      await prisma.inventoryItem.upsert({
        where: { variantId: savedVariant.id },
        create: { variantId: savedVariant.id, quantityOnHand: variant.stock, quantityAvailable: variant.stock, lowStockThreshold: 3 },
        update: {},
      });
    }

    await prisma.productImage.deleteMany({ where: { productId: saved.id } });
    const first = product.variants[0]!;
    await prisma.productImage.create({
      data: { productId: saved.id, storageKey: artPath(product.kind, first.color), alt: `${product.name} in ${first.color}`, width: 400, height: 400, isPrimary: true },
    });
    await prisma.productImage.createMany({
      data: product.variants.flatMap((variant, index) => [
        { productId: saved.id, variantId: variantIds[index]!, storageKey: artPath(product.kind, variant.color), alt: `${product.name} in ${variant.color}`, width: 400, height: 400, sortOrder: 1 },
        { productId: saved.id, variantId: variantIds[index]!, storageKey: artPath(product.kind, variant.color, "alt"), alt: `${product.name} in ${variant.color}, angled view`, width: 400, height: 400, sortOrder: 2 },
      ]),
    });
  }
}

async function seedCoupons(): Promise<void> {
  for (const { categorySlug, ...coupon } of COUPONS.map((c) => ({ categorySlug: undefined as string | undefined, ...c }))) {
    const category = categorySlug ? await prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } }) : null;
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      create: { ...coupon, ...(category ? { categories: { connect: { id: category.id } } } : {}) },
      update: { description: coupon.description },
    });
  }
}

async function seedReviews(): Promise<void> {
  const shipping = await prisma.shippingMethod.findUniqueOrThrow({ where: { code: "FREE_STANDARD" } });
  const customers = [];
  for (const customer of CUSTOMERS) {
    customers.push(
      await prisma.user.upsert({
        where: { email: customer.email },
        create: { ...customer, emailVerified: new Date() },
        update: {},
        select: { id: true, name: true },
      }),
    );
  }

  const touched = new Set<string>();
  for (const [index, [slug, customerIndex, rating, title, body, verified]] of REVIEWS.entries()) {
    const product = await prisma.product.findUnique({
      where: { slug },
      select: { id: true, name: true, variants: { where: { isDefault: true }, take: 1, select: { id: true, sku: true, title: true, priceMinor: true } } },
    });
    const customer = customers[customerIndex]!;
    const variant = product?.variants[0];
    if (!product || !variant) continue;
    if (await prisma.review.findUnique({ where: { productId_userId: { productId: product.id, userId: customer.id } } })) continue;

    let orderItemId: string | null = null;
    if (verified) {
      const deliveredAt = new Date(Date.now() - (index + 3) * 86_400_000);
      const order = await prisma.order.create({
        data: {
          orderNumber: `CLB-00SEED${String(index).padStart(5, "0")}`,
          userId: customer.id,
          status: "DELIVERED",
          subtotalMinor: variant.priceMinor,
          taxMinor: Math.round((variant.priceMinor * 1800) / 11800),
          shippingMinor: 0,
          totalMinor: variant.priceMinor,
          shippingAddress: { fullName: customer.name, line1: "Demo address", city: "Bengaluru", state: "Karnataka", postalCode: "560001", countryCode: "IN" },
          shippingMethodId: shipping.id,
          shippingMethodName: shipping.name,
          idempotencyKey: `seed-review-order-${index}`,
          placedAt: deliveredAt,
          deliveredAt,
          items: {
            create: {
              productId: product.id,
              variantId: variant.id,
              productName: product.name,
              variantTitle: variant.title,
              sku: variant.sku,
              unitPriceMinor: variant.priceMinor,
              quantity: 1,
              taxRateBps: 1800,
              taxMinor: Math.round((variant.priceMinor * 1800) / 11800),
              lineTotalMinor: variant.priceMinor,
            },
          },
        },
        select: { items: { select: { id: true } } },
      });
      orderItemId = order.items[0]!.id;
    }

    await prisma.review.create({
      data: {
        productId: product.id,
        userId: customer.id,
        orderItemId,
        rating,
        title,
        body,
        isVerifiedPurchase: verified,
        status: "APPROVED",
        createdAt: new Date(Date.now() - (index + 1) * 86_400_000),
      },
    });
    touched.add(product.id);
  }

  for (const productId of touched) {
    const aggregate = await prisma.review.aggregate({ where: { productId, status: "APPROVED" }, _avg: { rating: true }, _count: { _all: true } });
    await prisma.product.update({
      where: { id: productId },
      data: { ratingAverage: Math.round((aggregate._avg.rating ?? 0) * 10) / 10, ratingCount: aggregate._count._all },
    });
  }
}

async function main(): Promise<void> {
  await seedReference();
  await seedCatalog();
  await seedCoupons();
  await seedReviews();
  await seedStaff(prisma);
  const demoOrders = process.env.SEED_DEMO_ORDERS === "0" ? 0 : await seedDemoOrders(prisma);
  console.log(`Seeded ${SHIPPING_METHODS.length} shipping methods, ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${COUPONS.length} coupons, ${REVIEWS.length} reviews.`);
  console.log(`Staff: ${STAFF.map((member) => `${member.email} (${member.role})`).join(", ")}. Demo orders created: ${demoOrders}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
