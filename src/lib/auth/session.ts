import type { Role } from "@prisma/client";
import { Errors } from "@/lib/api/errors";
import { auth } from "./index";
import { hasPermission, type Permission } from "./rbac";
import { isAccessRevoked } from "./refresh-tokens";

export interface CurrentUser {
  id: string;
  role: Role;
  email: string | null;
  name: string | null;
}

export type AuthState =
  | { status: "authenticated"; user: CurrentUser }
  | { status: "expired" }
  | { status: "anonymous" };

/**
 * Authoritative server-side session check (Route Handlers, Server Actions, Server Components).
 * An access token past `accessExp`, or issued before a revocation, counts as expired: the
 * client must call /api/auth/refresh, which re-validates against the database.
 */
export async function getAuthState(): Promise<AuthState> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) {
    return { status: "anonymous" };
  }
  if (session.accessExpiresAt * 1000 <= Date.now()) {
    return { status: "expired" };
  }
  if (await isAccessRevoked(session.user.id, session.accessExpiresAt)) {
    return { status: "expired" };
  }
  return {
    status: "authenticated",
    user: {
      id: session.user.id,
      role: session.user.role,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    },
  };
}

/** The signed-in user, or null for guests. Expired sessions raise 401 token_expired. */
export async function getOptionalUser(): Promise<CurrentUser | null> {
  const state = await getAuthState();
  if (state.status === "expired") throw Errors.tokenExpired();
  return state.status === "authenticated" ? state.user : null;
}

export async function requireUser(): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.status === "expired") throw Errors.tokenExpired();
  if (state.status === "anonymous") throw Errors.unauthorized();
  return state.user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) {
    throw Errors.forbidden();
  }
  return user;
}
