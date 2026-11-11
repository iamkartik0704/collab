import type { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api/handler";
import type { Permission } from "@/lib/auth/rbac";
import { requirePermission, type CurrentUser } from "@/lib/auth/session";
import { RateLimitPolicies } from "@/lib/redis";
import { getClientIp, getUserAgent } from "@/lib/security/request";

/** Who is doing what, from where: attached to every admin mutation and its audit record. */
export interface AdminContext {
  actor: CurrentUser;
  ip: string;
  userAgent: string | undefined;
  requestId: string;
}

/**
 * Authorises an admin API call (the middleware already gated the path; this is the
 * authoritative server-side check) and rate-limits mutations per staff user.
 */
export async function requireAdmin(
  request: NextRequest,
  permission: Permission,
  requestId: string,
  options: { write?: boolean } = {},
): Promise<AdminContext> {
  const actor = await requirePermission(permission);
  if (options.write ?? request.method !== "GET") {
    await enforceRateLimit(RateLimitPolicies.adminWrite, actor.id);
  }
  return { actor, ip: getClientIp(request.headers), userAgent: getUserAgent(request.headers), requestId };
}
