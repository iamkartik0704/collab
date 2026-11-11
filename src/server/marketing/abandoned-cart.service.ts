import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { formatMoney } from "@/lib/utils";
import { queueNotification } from "@/server/notifications/notify";

/**
 * Abandoned-cart reminders. A signed-in customer's cart that has had no activity for
 * ABANDONED_AFTER (and still holds something buyable) gets exactly one reminder:
 *  - email when the customer allows cart reminders (NotificationPreference.abandonedCartReminder);
 *  - WhatsApp only with an explicit marketing opt-in;
 *  - a STOP reply on WhatsApp (whatsappOptOutAt) suppresses the WhatsApp reminder only; email
 *    still goes out unless the customer turned email cart reminders off.
 * The cart is claimed with a conditional update before anything is queued, so concurrent
 * workers or a retried job never send twice. Guest carts have no contact details and are skipped.
 */

const log = childLogger({ service: "abandoned-cart" });

export const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;
/** Older carts are stale: reminding about them is noise. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 200;

export async function sendAbandonedCartReminders(now = new Date()): Promise<{ considered: number; reminded: number; skipped: number }> {
  const carts = await db.cart.findMany({
    where: {
      userId: { not: null },
      abandonedReminderSentAt: null,
      lastActivityAt: { lte: new Date(now.getTime() - ABANDONED_AFTER_MS), gte: new Date(now.getTime() - MAX_AGE_MS) },
      items: { some: {} },
    },
    orderBy: { lastActivityAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      lastActivityAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          notificationPreference: { select: { abandonedCartReminder: true, whatsappOptIn: true, whatsappMarketing: true, whatsappOptOutAt: true } },
        },
      },
      items: {
        select: {
          quantity: true,
          variant: {
            select: {
              priceMinor: true,
              isActive: true,
              deletedAt: true,
              inventory: { select: { quantityAvailable: true } },
              product: { select: { name: true, status: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });

  let reminded = 0;
  let skipped = 0;
  for (const cart of carts) {
    const user = cart.user;
    const prefs = user?.notificationPreference;
    const buyable = cart.items.filter(
      (item) =>
        item.variant.isActive && !item.variant.deletedAt && item.variant.product.status === "ACTIVE" && !item.variant.product.deletedAt && (item.variant.inventory?.quantityAvailable ?? 0) > 0,
    );
    const wantsEmail = Boolean(user?.email) && (prefs?.abandonedCartReminder ?? true);
    const wantsWhatsApp = Boolean(user?.phone) && Boolean(prefs?.whatsappOptIn && prefs.whatsappMarketing) && !prefs?.whatsappOptOutAt;

    // Claim first: whatever happens next, this cart is never reminded again.
    const claim = await db.cart.updateMany({ where: { id: cart.id, abandonedReminderSentAt: null, lastActivityAt: cart.lastActivityAt }, data: { abandonedReminderSentAt: now } });
    if (claim.count === 0) continue; // the customer came back, or another worker took it

    if (!user || !user.isActive || buyable.length === 0 || (!wantsEmail && !wantsWhatsApp)) {
      skipped++;
      continue;
    }
    // Paid since the last cart activity? The leftover items are probably not wanted.
    const recentOrder = await db.order.count({ where: { userId: user.id, placedAt: { gte: cart.lastActivityAt } } });
    if (recentOrder > 0) {
      skipped++;
      continue;
    }

    const names = buyable.map((item) => item.variant.product.name);
    const totalMinor = buyable.reduce((sum, item) => sum + item.variant.priceMinor * item.quantity, 0);
    const templateData = {
      customerName: user.name ?? "there",
      itemCount: buyable.reduce((sum, item) => sum + item.quantity, 0),
      itemSummary: names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and "),
      cartTotal: formatMoney(totalMinor),
    };
    const deliveries: Array<Promise<string>> = [];
    if (wantsEmail) deliveries.push(queueNotification({ type: "ABANDONED_CART", channel: "EMAIL", recipient: user.email!, userId: user.id, templateData }));
    if (wantsWhatsApp) deliveries.push(queueNotification({ type: "ABANDONED_CART", channel: "WHATSAPP", recipient: user.phone!, userId: user.id, templateData }));
    const results = await Promise.allSettled(deliveries);
    results.forEach((result) => result.status === "rejected" && log.error({ err: result.reason, cartId: cart.id }, "cart reminder not queued"));
    reminded++;
  }
  if (carts.length > 0) log.info({ considered: carts.length, reminded, skipped }, "abandoned-cart reminders");
  return { considered: carts.length, reminded, skipped };
}
