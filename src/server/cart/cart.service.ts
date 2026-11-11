import { Errors } from "@/lib/api/errors";
import { db, isCheckViolation, isUniqueConstraintError, withTransaction, type TransactionClient } from "@/lib/db";
import { MAX_CART_LINES, MAX_QUANTITY_PER_LINE } from "@/schemas/cart";
import { normalizeCouponCode } from "@/server/coupons/coupon.service";
import { priceCart, type PricedCart } from "./pricing";

/**
 * Server-side cart. Items store only variant + quantity; prices are always recomputed by
 * priceCart(). Guests are identified by an HttpOnly cookie token and merged on sign-in.
 */

export { MAX_CART_LINES, MAX_QUANTITY_PER_LINE };

export type CartOwner = { kind: "user"; userId: string } | { kind: "guest"; guestToken: string };

function ownerWhere(owner: CartOwner) {
  return owner.kind === "user" ? { userId: owner.userId } : { guestToken: owner.guestToken };
}

async function ensureCart(tx: TransactionClient, owner: CartOwner): Promise<{ id: string }> {
  const where = ownerWhere(owner);
  try {
    return await tx.cart.upsert({ where, create: where, update: {}, select: { id: true } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return tx.cart.findUniqueOrThrow({ where, select: { id: true } });
    }
    throw error;
  }
}

/**
 * Records shopper activity. The abandoned-cart reminder flag is deliberately NOT reset here:
 * a cart gets at most one reminder. It starts over only when a purchase empties the cart.
 */
async function touchCart(tx: TransactionClient, cartId: string): Promise<void> {
  await tx.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date() } });
}

async function purchasableAvailability(tx: TransactionClient, variantId: string): Promise<number> {
  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, isActive: true, deletedAt: null, product: { status: "ACTIVE", deletedAt: null } },
    select: { inventory: { select: { quantityAvailable: true } } },
  });
  if (!variant) {
    throw Errors.notFound("Product");
  }
  return variant.inventory?.quantityAvailable ?? 0;
}

function assertQuantityAllowed(quantity: number, available: number): void {
  if (quantity > MAX_QUANTITY_PER_LINE) {
    throw Errors.unprocessable("quantity_limit", `You can buy at most ${MAX_QUANTITY_PER_LINE} of this item.`, {
      max: MAX_QUANTITY_PER_LINE,
    });
  }
  if (quantity > available) {
    throw Errors.conflict("insufficient_stock", available > 0 ? `Only ${available} left in stock.` : "This item is out of stock.", {
      available,
    });
  }
}

export async function getCartPriced(owner: CartOwner, userId: string | null): Promise<PricedCart> {
  const cart = await db.cart.findUnique({
    where: ownerWhere(owner),
    select: { couponCode: true, items: { orderBy: { createdAt: "asc" }, select: { variantId: true, quantity: true } } },
  });
  return priceCart({ lines: cart?.items ?? [], couponCode: cart?.couponCode ?? null, userId });
}

/** Adds `quantity` (atomic increment) and enforces the per-line cap and live stock. */
export async function addCartItem(owner: CartOwner, variantId: string, quantity: number): Promise<void> {
  await withTransaction(async (tx) => {
    const available = await purchasableAvailability(tx, variantId);
    const cart = await ensureCart(tx, owner);
    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
      select: { quantity: true },
    });
    if (!existing && (await tx.cartItem.count({ where: { cartId: cart.id } })) >= MAX_CART_LINES) {
      throw Errors.unprocessable("cart_full", `A cart can hold at most ${MAX_CART_LINES} different items.`);
    }
    // Validate before writing (the DB CHECK caps a line at 10 units)...
    assertQuantityAllowed((existing?.quantity ?? 0) + quantity, available);
    let item: { quantity: number };
    try {
      item = await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        create: { cartId: cart.id, variantId, quantity },
        update: { quantity: { increment: quantity } },
        select: { quantity: true },
      });
    } catch (error) {
      // ...and map a concurrent add that overshoots the CHECK to the same client error.
      if (isCheckViolation(error, "CartItem_quantity_range")) {
        assertQuantityAllowed(MAX_QUANTITY_PER_LINE + 1, available);
      }
      throw error;
    }
    // A concurrent add may have raced past the stock check: re-validate the final quantity.
    assertQuantityAllowed(item.quantity, available);
    await touchCart(tx, cart.id);
  });
}

/** Sets an exact quantity; 0 removes the line. */
export async function setCartItemQuantity(owner: CartOwner, variantId: string, quantity: number): Promise<void> {
  if (quantity === 0) {
    await removeCartItem(owner, variantId);
    return;
  }
  await withTransaction(async (tx) => {
    const cart = await tx.cart.findUnique({ where: ownerWhere(owner), select: { id: true } });
    const item = cart
      ? await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } }, select: { id: true } })
      : null;
    if (!cart || !item) {
      throw Errors.notFound("Cart item");
    }
    assertQuantityAllowed(quantity, await purchasableAvailability(tx, variantId));
    await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
    await touchCart(tx, cart.id);
  });
}

export async function removeCartItem(owner: CartOwner, variantId: string): Promise<void> {
  const cart = await db.cart.findUnique({ where: ownerWhere(owner), select: { id: true } });
  if (!cart) return;
  await db.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
  await touchCart(db, cart.id);
}

/**
 * Validates a coupon against the current cart and stores it. Invalid coupons are rejected
 * with the reason and never stored. Pass null to remove.
 */
export async function setCartCoupon(owner: CartOwner, rawCode: string | null, userId: string | null): Promise<PricedCart> {
  const cart = await db.cart.findUnique({
    where: ownerWhere(owner),
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
  });
  if (rawCode === null) {
    if (cart) await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    return priceCart({ lines: cart?.items ?? [], userId });
  }
  if (!cart || cart.items.length === 0) {
    throw Errors.unprocessable("cart_empty", "Add something to your cart before applying a coupon.");
  }
  const code = normalizeCouponCode(rawCode);
  if (!code) {
    throw Errors.unprocessable("invalid_code", "That coupon code is not valid.");
  }
  const priced = await priceCart({ lines: cart.items, couponCode: code, userId });
  if (!priced.coupon?.applied) {
    const rejection = priced.coupon && !priced.coupon.applied ? priced.coupon : null;
    throw Errors.unprocessable(rejection?.reason ?? "invalid_code", rejection?.message ?? "That coupon code is not valid.");
  }
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
  return priced;
}

/** Moves a guest cart into the user's cart on sign-in (quantities summed, capped by stock). */
export async function mergeGuestCart(guestToken: string, userId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const guest = await tx.cart.findUnique({
      where: { guestToken },
      select: { id: true, couponCode: true, items: { select: { variantId: true, quantity: true } } },
    });
    if (!guest) return;
    const target = await ensureCart(tx, { kind: "user", userId });

    for (const item of guest.items) {
      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId, isActive: true, deletedAt: null, product: { status: "ACTIVE", deletedAt: null } },
        select: { inventory: { select: { quantityAvailable: true } } },
      });
      if (!variant) continue;
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: target.id, variantId: item.variantId } },
        select: { quantity: true },
      });
      const merged = Math.min(
        (existing?.quantity ?? 0) + item.quantity,
        MAX_QUANTITY_PER_LINE,
        variant.inventory?.quantityAvailable ?? 0,
      );
      if (merged <= 0) continue;
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: target.id, variantId: item.variantId } },
        create: { cartId: target.id, variantId: item.variantId, quantity: merged },
        update: { quantity: merged },
      });
    }

    const userCart = await tx.cart.findUniqueOrThrow({ where: { id: target.id }, select: { couponCode: true } });
    await tx.cart.update({
      where: { id: target.id },
      data: { couponCode: userCart.couponCode ?? guest.couponCode, lastActivityAt: new Date() },
    });
    await tx.cart.delete({ where: { id: guest.id } });
  });
}

/** Removes purchased lines from the buyer's cart once the order is paid. */
export async function clearPurchasedItems(tx: TransactionClient, userId: string, variantIds: readonly string[]): Promise<void> {
  const cart = await tx.cart.findUnique({ where: { userId }, select: { id: true } });
  if (!cart) return;
  await tx.cartItem.deleteMany({ where: { cartId: cart.id, variantId: { in: [...variantIds] } } });
  const remaining = await tx.cartItem.count({ where: { cartId: cart.id } });
  // A purchase that empties the cart starts a new "cart" for reminder purposes.
  await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null, ...(remaining === 0 ? { abandonedReminderSentAt: null } : {}) } });
}
