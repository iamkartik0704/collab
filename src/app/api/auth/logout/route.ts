import { json, route } from "@/lib/api/handler";
import { auth } from "@/lib/auth";
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { findRefreshFamily, revokeRefreshFamily, revokeUserAccess } from "@/lib/auth/refresh-tokens";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout - revokes this device's refresh-token family, invalidates outstanding
 * access tokens for the user (other devices transparently refresh), and clears both cookies.
 */
export const POST = route(async (request) => {
  const raw = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  const family = raw ? await findRefreshFamily(raw) : null;
  if (family) {
    await revokeRefreshFamily(family.familyId, "signed_out");
  }
  const session = await auth();
  const userId = family?.userId ?? session?.user?.id;
  if (userId) {
    await revokeUserAccess(userId);
  }

  const response = json({ signedOut: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
  response.cookies.set(REFRESH_COOKIE_NAME, "", { ...refreshCookieOptions(0), path: REFRESH_COOKIE_PATH });
  return response;
});
