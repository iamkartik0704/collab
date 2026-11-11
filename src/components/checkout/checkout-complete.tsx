"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/utils";
import { CART_KEY } from "@/hooks/use-cart";
import { Button } from "@/components/ui/button";

interface OrderStatusView {
  order: {
    orderNumber: string;
    status: string;
    currency: string;
    totalMinor: number;
    cancelReason: string | null;
    estimatedDeliveryAt: string | null;
    shippingMethodName: string;
    items: Array<{ productName: string; variantTitle: string; quantity: number; lineTotalMinor: number }>;
    payment: { status: string; failureMessage: string | null } | null;
  };
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 90_000;

/**
 * The order is confirmed only by the provider's signed webhook, so this page polls until the
 * order leaves PENDING_PAYMENT (normally a few seconds after payment).
 */
export function CheckoutComplete({ orderNumber, redirectStatus }: { orderNumber: string; redirectStatus: string | null }) {
  const queryClient = useQueryClient();
  const startedAt = useRef(Date.now());
  const { data, error } = useQuery({
    queryKey: ["order-status", orderNumber],
    queryFn: () => apiFetch<OrderStatusView>(`/api/orders/${encodeURIComponent(orderNumber)}`),
    refetchInterval: (query) => {
      const status = query.state.data?.order.status;
      const waiting = !status || status === "PENDING_PAYMENT";
      return waiting && Date.now() - startedAt.current < MAX_WAIT_MS && redirectStatus !== "failed" ? POLL_MS : false;
    },
  });

  const order = data?.order;
  const confirmed = order && order.status !== "PENDING_PAYMENT" && order.status !== "CANCELLED" && order.status !== "PAYMENT_FAILED";
  const failed = redirectStatus === "failed" || order?.status === "CANCELLED" || order?.status === "PAYMENT_FAILED";

  useEffect(() => {
    if (confirmed) void queryClient.invalidateQueries({ queryKey: CART_KEY });
  }, [confirmed, queryClient]);

  if (error) {
    return <Shell icon={<XCircle className="size-14 text-danger" />} title="We couldn't find that order" body="Check the link or find it in your account." />;
  }

  if (failed && order) {
    return (
      <Shell
        icon={<XCircle className="size-14 text-danger" />}
        title="Payment not completed"
        body={
          order.cancelReason === "out_of_stock_after_payment"
            ? "An item sold out before your payment arrived. A full refund is on its way to your original payment method."
            : (order.payment?.failureMessage ?? "Your payment didn't go through and you haven't been charged. Your cart is still saved.")
        }
        actions={
          <Button asChild size="lg">
            <Link href="/cart">Return to cart</Link>
          </Button>
        }
      />
    );
  }

  if (!confirmed || !order) {
    return (
      <Shell
        icon={<Clock className="size-14 animate-pulse text-muted" />}
        title="Confirming your payment…"
        body={`We're waiting for confirmation from your bank for order ${orderNumber}. This usually takes a few seconds — you can safely leave this page; we'll email you either way.`}
      />
    );
  }

  return (
    <Shell
      icon={<CheckCircle2 className="size-14 text-success" />}
      title="Thank you! Your order is placed."
      body={`Order ${order.orderNumber} is confirmed${order.estimatedDeliveryAt ? ` and should arrive by ${new Date(order.estimatedDeliveryAt).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}` : ""}. A confirmation is on its way to you.`}
      actions={
        <>
          <Button asChild variant="outline" size="lg">
            <Link href="/catalog">Continue shopping</Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/account">View my orders</Link>
          </Button>
        </>
      }
    >
      <ul className="mt-8 w-full max-w-md divide-y divide-line rounded-[var(--radius-card)] border border-line text-left">
        {order.items.map((item) => (
          <li key={`${item.productName}-${item.variantTitle}`} className="flex justify-between gap-4 px-5 py-3 text-sm">
            <span>
              {item.productName} <span className="text-muted-2">· {item.variantTitle} × {item.quantity}</span>
            </span>
            <span className="font-medium">{formatMoney(item.lineTotalMinor, order.currency)}</span>
          </li>
        ))}
        <li className="flex justify-between px-5 py-3 font-semibold">
          <span>Total paid</span>
          <span>{formatMoney(order.totalMinor, order.currency)}</span>
        </li>
      </ul>
    </Shell>
  );
}

function Shell({ icon, title, body, actions, children }: { icon: React.ReactNode; title: string; body: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="container-site flex flex-col items-center py-24 text-center" role="status" aria-live="polite">
      {icon}
      <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-lg text-muted-2">{body}</p>
      {children}
      {actions && <div className="mt-10 flex gap-4">{actions}</div>}
    </div>
  );
}
