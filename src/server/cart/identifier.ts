import { getClientIp } from "@/lib/security/request";
import type { CartContext } from "./identity";

/** Rate-limit identity for cart/coupon endpoints: the user when signed in, else the IP. */
export function rateLimitIdentity(context: CartContext | null, headers: Headers): string {
  return context?.user ? `user:${context.user.id}` : `ip:${getClientIp(headers)}`;
}
