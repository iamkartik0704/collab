import { json, route } from "@/lib/api/handler";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/shipping-methods - active delivery options for checkout step 2. */
export const GET = route(async () => {
  const methods = await db.shippingMethod.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { priceMinor: "asc" }],
    select: { code: true, name: true, description: true, speed: true, priceMinor: true, freeAboveMinor: true, minDays: true, maxDays: true, requiresSlot: true },
  });
  return json({ methods });
});
