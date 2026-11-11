import { cookies } from "next/headers";
import { GUEST_CART_COOKIE_NAME, guestCartCookieOptions } from "@/lib/auth/cookies";
import { getOptionalUser, type CurrentUser } from "@/lib/auth/session";
import { randomToken } from "@/lib/crypto";
import type { CartOwner } from "./cart.service";

const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface CartContext {
  owner: CartOwner;
  user: CurrentUser | null;
}

/**
 * Signed-in users own their cart by user id; guests by an HttpOnly cookie token. With
 * `create`, a guest without a cookie gets a fresh token (written to the response).
 * Returns null for a guest without a cart when `create` is false.
 */
export async function resolveCartContext(options: { create: boolean }): Promise<CartContext | null> {
  const user = await getOptionalUser();
  if (user) {
    return { owner: { kind: "user", userId: user.id }, user };
  }
  const cookieStore = await cookies();
  const existing = cookieStore.get(GUEST_CART_COOKIE_NAME)?.value;
  if (existing && GUEST_TOKEN.test(existing)) {
    return { owner: { kind: "guest", guestToken: existing }, user: null };
  }
  if (!options.create) {
    return null;
  }
  const guestToken = randomToken(32);
  cookieStore.set(GUEST_CART_COOKIE_NAME, guestToken, guestCartCookieOptions());
  return { owner: { kind: "guest", guestToken }, user: null };
}
