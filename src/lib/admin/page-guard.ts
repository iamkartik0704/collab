import { redirect } from "next/navigation";
import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { getAuthState, type CurrentUser } from "@/lib/auth/session";

/**
 * Server Component guard for /admin pages. The middleware already gates these paths; this is
 * the authoritative re-check (it also sees revocations the edge cannot).
 */
export async function requireAdminPage(permission: Permission, path: string): Promise<CurrentUser> {
  const state = await getAuthState();
  if (state.status === "expired") redirect(`/api/auth/refresh?callbackUrl=${encodeURIComponent(path)}`);
  if (state.status !== "authenticated") redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  if (!hasPermission(state.user.role, permission)) {
    redirect(hasPermission(state.user.role, "admin:access") ? "/admin?denied=1" : "/");
  }
  return state.user;
}
