import type { Role } from "@prisma/client";

/**
 * Role-based access control. Permissions are the unit of authorisation; roles are bundles of
 * permissions. Server code checks permissions (never raw role names) so roles can evolve.
 * This module has no runtime dependencies and is shared by middleware and server code.
 */

export const PERMISSIONS = {
  "admin:access": ["SUPPORT_AGENT", "INVENTORY_MANAGER", "SUPER_ADMIN"],
  "dashboard:read": ["SUPPORT_AGENT", "INVENTORY_MANAGER", "SUPER_ADMIN"],
  "catalog:write": ["INVENTORY_MANAGER", "SUPER_ADMIN"],
  "inventory:write": ["INVENTORY_MANAGER", "SUPER_ADMIN"],
  "orders:read": ["SUPPORT_AGENT", "INVENTORY_MANAGER", "SUPER_ADMIN"],
  "orders:manage": ["INVENTORY_MANAGER", "SUPER_ADMIN"],
  "refunds:issue": ["SUPER_ADMIN"],
  "coupons:manage": ["SUPER_ADMIN"],
  "support:inbox": ["SUPPORT_AGENT", "SUPER_ADMIN"],
  "users:manage-roles": ["SUPER_ADMIN"],
  "audit:read": ["SUPER_ADMIN"],
  "ai:manage": ["SUPER_ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Most specific prefix first. API routes under /api/admin/* map to the same rules. */
const ADMIN_ROUTE_RULES: ReadonlyArray<{ prefix: string; permission: Permission }> = [
  { prefix: "/admin/products", permission: "catalog:write" },
  { prefix: "/admin/uploads", permission: "catalog:write" },
  { prefix: "/admin/inventory", permission: "inventory:write" },
  { prefix: "/admin/orders", permission: "orders:read" },
  { prefix: "/admin/coupons", permission: "coupons:manage" },
  { prefix: "/admin/support", permission: "support:inbox" },
  { prefix: "/admin/users", permission: "users:manage-roles" },
  { prefix: "/admin/audit-log", permission: "audit:read" },
  { prefix: "/admin/ai", permission: "ai:manage" },
  { prefix: "/admin", permission: "admin:access" },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Permission required to reach `pathname`, or null when the path is not an admin path. */
export function requiredPermissionForPath(pathname: string): Permission | null {
  const normalized = pathname.startsWith("/api/admin") ? pathname.slice("/api".length) : pathname;
  for (const rule of ADMIN_ROUTE_RULES) {
    if (matchesPrefix(normalized, rule.prefix)) {
      return rule.permission;
    }
  }
  return null;
}

/** Customer areas that require a signed-in user (any role). */
const AUTHENTICATED_PREFIXES = ["/account", "/checkout"];

export function requiresAuthentication(pathname: string): boolean {
  return AUTHENTICATED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}
