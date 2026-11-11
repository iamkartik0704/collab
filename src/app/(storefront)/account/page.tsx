import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAuthState } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  PAYMENT_FAILED: "Payment failed",
  RETURNED: "Returned",
};

/** Account overview with recent orders. The full customer portal arrives in Phase 5. */
export default async function AccountPage() {
  const state = await getAuthState();
  if (state.status === "expired") redirect("/api/auth/refresh?callbackUrl=%2Faccount");
  if (state.status !== "authenticated") redirect("/login?callbackUrl=%2Faccount");

  const orders = await db.order.findMany({
    where: { userId: state.user.id, status: { not: "PENDING_PAYMENT" } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { orderNumber: true, status: true, totalMinor: true, currency: true, createdAt: true, placedAt: true, _count: { select: { items: true } } },
  });

  return (
    <div className="container-site py-14">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Hello{state.user.name ? `, ${state.user.name.split(" ")[0]}` : ""}</h1>
          <p className="mt-1 text-sm text-muted-2">{state.user.email}</p>
        </div>
        <SignOutButton />
      </div>

      <section aria-labelledby="orders-title" className="mt-12">
        <h2 id="orders-title" className="text-xl font-medium">
          Your orders
        </h2>
        {orders.length === 0 ? (
          <p className="mt-6 rounded-[var(--radius-card)] bg-surface p-8 text-center text-muted-2">
            No orders yet.{" "}
            <Link href="/catalog" className="font-medium text-ink underline underline-offset-4">
              Start shopping
            </Link>
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {orders.map((order) => (
              <li key={order.orderNumber} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div>
                  <Link href={`/account/orders/${order.orderNumber}`} className="font-medium underline-offset-4 hover:underline">
                    {order.orderNumber}
                  </Link>
                  <p className="text-sm text-muted-2">
                    {order.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {order._count.items} item
                    {order._count.items === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="rounded bg-surface px-2 py-1 text-xs font-semibold">{STATUS_LABELS[order.status] ?? order.status}</span>
                <span className="font-semibold">{formatMoney(order.totalMinor, order.currency)}</span>
                {order.placedAt && (
                  <a href={`/api/orders/${order.orderNumber}/invoice`} className="text-sm underline underline-offset-4">
                    Invoice (PDF)
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
