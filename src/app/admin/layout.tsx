import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell, type AdminNavItem } from "@/components/admin/admin-shell";
import { requireAdminPage } from "@/lib/admin/page-guard";
import { hasPermission, type Permission } from "@/lib/auth/rbac";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Collab Admin" },
  robots: { index: false, follow: false },
};

const NAV: Array<AdminNavItem & { permission: Permission }> = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", permission: "dashboard:read" },
  { href: "/admin/orders", label: "Orders", icon: "orders", permission: "orders:read" },
  { href: "/admin/products", label: "Products", icon: "products", permission: "catalog:write" },
  { href: "/admin/inventory", label: "Inventory", icon: "inventory", permission: "inventory:write" },
  { href: "/admin/support", label: "Support inbox", icon: "support", permission: "support:inbox" },
  { href: "/admin/coupons", label: "Coupons", icon: "coupons", permission: "coupons:manage" },
  { href: "/admin/audit-log", label: "Audit log", icon: "audit", permission: "audit:read" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminPage("admin:access", "/admin");
  const items = NAV.filter((item) => hasPermission(user.role, item.permission)).map(({ permission: _permission, ...item }) => item);
  return (
    <AdminShell items={items} user={{ name: user.name, email: user.email, role: user.role }}>
      {children}
    </AdminShell>
  );
}
