import type { NotificationChannel, NotificationType } from "@prisma/client";
import { createElement, type ReactElement } from "react";
import { render, toPlainText } from "react-email";
import { env } from "@/env";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { formatMoney } from "@/lib/utils";
import { ORDER_COPY, OrderUpdateEmail, type OrderEmailProps, type OrderUpdateKind } from "@/emails/order-update";
import { OtpEmail, StaffAlertEmail } from "@/emails/simple";
import type { EmailAttachment } from "@/services/email.service";
import type { WhatsAppTemplate } from "@/services/whatsapp.service";
import { ensureInvoice } from "@/server/invoices/invoice.service";

/**
 * Turns a queued notification into a concrete message. Order emails are rendered from the live
 * order snapshot (items, totals, tracking) rather than the job payload, so a retried job always
 * reflects the current state. WhatsApp uses pre-approved templates (names below must exist in
 * WhatsApp Manager with the same parameter order).
 */

const log = childLogger({ service: "notification-render" });

export type RenderedNotification =
  | { channel: "EMAIL"; templateName: string; subject: string; html: string; text: string; attachments: EmailAttachment[] }
  | { channel: "WHATSAPP"; templateName: string; template: WhatsAppTemplate };

export const WHATSAPP_TEMPLATES: Record<NotificationType, string> = {
  OTP: "collab_login_otp",
  ORDER_CONFIRMATION: "collab_order_confirmed",
  ORDER_SHIPPED: "collab_order_shipped",
  OUT_FOR_DELIVERY: "collab_out_for_delivery",
  ORDER_DELIVERED: "collab_order_delivered",
  ABANDONED_CART: "collab_cart_reminder",
  LOW_STOCK_ALERT: "collab_low_stock_alert",
  REFUND_ISSUED: "collab_refund_issued",
  SUPPORT_ESCALATION: "collab_support_escalation",
};

const ORDER_KINDS = new Set<NotificationType>(["ORDER_CONFIRMATION", "ORDER_SHIPPED", "OUT_FOR_DELIVERY", "ORDER_DELIVERED", "REFUND_ISSUED"]);

type TemplateData = Record<string, string | number>;

const str = (data: TemplateData, key: string, fallback = ""): string => (data[key] === undefined ? fallback : String(data[key]));
const num = (data: TemplateData, key: string): number | null => (typeof data[key] === "number" ? (data[key] as number) : data[key] !== undefined && !Number.isNaN(Number(data[key])) ? Number(data[key]) : null);

async function email(element: ReactElement, subject: string, templateName: string, attachments: EmailAttachment[] = []): Promise<RenderedNotification> {
  const html = await render(element);
  return { channel: "EMAIL", templateName, subject, html, text: toPlainText(html), attachments };
}

async function orderEmailProps(kind: OrderUpdateKind, orderId: string, data: TemplateData): Promise<OrderEmailProps | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { createdAt: "asc" } }, user: { select: { name: true } } },
  });
  if (!order) return null;
  const money = (minor: number) => formatMoney(minor, order.currency);
  const address = (order.shippingAddress ?? {}) as Record<string, string | null | undefined>;
  const refund = num(data, "refundMinor");
  return {
    kind,
    appUrl: env.APP_URL,
    customerName: (order.user.name ?? address.fullName ?? "there").split(" ")[0]!,
    orderNumber: order.orderNumber,
    items: order.items.map((item) => ({ name: item.productName, variant: item.variantTitle, quantity: item.quantity, lineTotal: money(item.lineTotalMinor) })),
    totals: {
      subtotal: money(order.subtotalMinor),
      discount: order.discountMinor > 0 ? money(order.discountMinor) : null,
      shipping: order.shippingMinor === 0 ? "Free" : money(order.shippingMinor),
      tax: money(order.taxMinor),
      total: money(order.totalMinor),
    },
    address: [address.fullName, address.line1, address.line2, address.city, address.state, address.postalCode].filter((line): line is string => Boolean(line)),
    tracking: order.carrierName && order.trackingNumber ? { carrier: order.carrierName, number: order.trackingNumber, url: order.trackingUrl } : null,
    refundAmount: kind === "REFUND_ISSUED" && refund !== null ? money(refund) : null,
    estimatedDelivery: order.estimatedDeliveryAt
      ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(order.estimatedDeliveryAt)
      : null,
    hasInvoice: false,
  };
}

export async function renderNotification(input: { type: NotificationType; channel: NotificationChannel; orderId: string | null; templateData: TemplateData }): Promise<RenderedNotification> {
  const { type, channel, templateData: data } = input;

  if (channel === "WHATSAPP") {
    const name = WHATSAPP_TEMPLATES[type];
    const language = "en";
    const firstName = str(data, "customerName", "there").split(" ")[0]!;
    const total = num(data, "totalMinor");
    const currency = str(data, "currency", "INR");
    switch (type) {
      case "OTP":
        return { channel, templateName: name, template: { name, language, bodyParams: [str(data, "code")], otpCode: str(data, "code") } };
      case "ORDER_CONFIRMATION":
        return { channel, templateName: name, template: { name, language, bodyParams: [firstName, str(data, "orderNumber"), total === null ? "" : formatMoney(total, currency)] } };
      case "ORDER_SHIPPED":
        return { channel, templateName: name, template: { name, language, bodyParams: [firstName, str(data, "orderNumber"), str(data, "carrierName", "our courier"), str(data, "trackingNumber", "-")] } };
      case "OUT_FOR_DELIVERY":
      case "ORDER_DELIVERED":
      case "ABANDONED_CART":
        return { channel, templateName: name, template: { name, language, bodyParams: type === "ABANDONED_CART" ? [firstName, str(data, "itemSummary", "your items")] : [firstName, str(data, "orderNumber")] } };
      case "REFUND_ISSUED": {
        const refund = num(data, "refundMinor");
        return { channel, templateName: name, template: { name, language, bodyParams: [firstName, refund === null ? "" : formatMoney(refund, currency), str(data, "orderNumber")] } };
      }
      case "LOW_STOCK_ALERT":
        return { channel, templateName: name, template: { name, language, bodyParams: [str(data, "sku"), str(data, "productName").slice(0, 60), str(data, "available"), str(data, "threshold")] } };
      case "SUPPORT_ESCALATION":
        return { channel, templateName: name, template: { name, language, bodyParams: [str(data, "ticketNumber"), str(data, "priority"), str(data, "subject").slice(0, 120)] } };
    }
  }

  if (type === "OTP") {
    const minutes = num(data, "expiresInMinutes") ?? 5;
    return email(createElement(OtpEmail, { appUrl: env.APP_URL, code: str(data, "code"), expiresInMinutes: minutes }), `${str(data, "code")} is your Collab sign-in code`, "otp");
  }

  if (ORDER_KINDS.has(type)) {
    const kind = type as OrderUpdateKind;
    if (!input.orderId) throw new Error(`${type} email without an order`);
    const props = await orderEmailProps(kind, input.orderId, data);
    if (!props) throw new Error(`order ${input.orderId} not found for ${type}`);
    const attachments: EmailAttachment[] = [];
    if (kind === "ORDER_CONFIRMATION") {
      try {
        const invoice = await ensureInvoice(input.orderId);
        attachments.push({ filename: invoice.filename, content: invoice.pdf, contentType: "application/pdf" });
        props.hasInvoice = true;
      } catch (error) {
        // The confirmation must not wait on the PDF; the customer can download it later.
        log.warn({ err: error, orderId: input.orderId }, "invoice not attached to confirmation");
      }
    }
    return email(createElement(OrderUpdateEmail, props), ORDER_COPY[kind].subject(props.orderNumber), `order-${kind.toLowerCase()}`, attachments);
  }

  if (type === "LOW_STOCK_ALERT") {
    const available = num(data, "available") ?? 0;
    const title = available <= 0 ? `Out of stock: ${str(data, "sku")}` : `Low stock: ${str(data, "sku")}`;
    return email(
      createElement(StaffAlertEmail, {
        appUrl: env.APP_URL,
        title,
        lines: [`${str(data, "productName")} (${str(data, "sku")}) has ${available} unit(s) available to sell.`, `Alert threshold: ${str(data, "threshold")} unit(s).`],
        actionLabel: "Open inventory",
        actionPath: `/admin/inventory?q=${encodeURIComponent(str(data, "sku"))}`,
      }),
      title,
      "staff-low-stock",
    );
  }

  if (type === "SUPPORT_ESCALATION") {
    const title = `[${str(data, "priority", "NORMAL")}] Support escalation ${str(data, "ticketNumber")}`;
    return email(
      createElement(StaffAlertEmail, {
        appUrl: env.APP_URL,
        title,
        lines: [str(data, "subject"), str(data, "summary"), data.customerName ? `Customer: ${str(data, "customerName")}` : ""].filter(Boolean),
        actionLabel: "Open support inbox",
        actionPath: `/admin/support${data.sessionId ? `/${str(data, "sessionId")}` : ""}`,
      }),
      title,
      "staff-support-escalation",
    );
  }

  // ABANDONED_CART (email)
  return email(
    createElement(StaffAlertEmail, {
      appUrl: env.APP_URL,
      title: "You left something in your cart",
      lines: [
        `Hi ${str(data, "customerName", "there").split(" ")[0]}, ${str(data, "itemSummary", "the items in your cart")} ${num(data, "itemCount") === 1 ? "is" : "are"} still in your cart${data.cartTotal ? ` (${str(data, "cartTotal")})` : ""}.`,
        "Stock moves quickly on popular models, so we can't hold them for long.",
      ],
      actionLabel: "Return to your cart",
      actionPath: "/cart",
    }),
    "Still thinking it over?",
    "abandoned-cart",
  );
}
