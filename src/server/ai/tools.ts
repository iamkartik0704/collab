import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma, TicketCategory, TicketPriority } from "@prisma/client";
import { z } from "zod";
import { env } from "@/env";
import { randomBase32 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { rateLimit, type RateLimitPolicy } from "@/lib/redis";
import { formatMoney } from "@/lib/utils";
import { queueNotification } from "@/server/notifications/notify";
import { searchKnowledge } from "./rag";

/**
 * Tools the support agent may call. Every tool enforces its own authorisation from the chat
 * context (never from model-supplied identifiers alone): a customer only ever sees their own
 * orders; a guest must prove ownership with the order's email or phone. Results are compact
 * JSON with no internal ids beyond what the customer already knows.
 */

const log = childLogger({ service: "support-agent-tools" });

export interface ToolContext {
  sessionId: string;
  user: { id: string; name: string | null; email: string | null } | null;
}

type ToolResult = { content: string; isError?: boolean; escalated?: { ticketNumber: string } };

// ============================================================================ schemas

const searchHelpInput = z.object({ query: z.string().trim().min(2).max(300) }).strict();
const searchProductsInput = z
  .object({
    query: z.string().trim().min(1).max(120),
    max_price_rupees: z.number().int().positive().max(10_000_000).nullable().optional(),
    in_stock_only: z.boolean().nullable().optional(),
  })
  .strict();
const orderStatusInput = z
  .object({
    order_number: z.string().trim().toUpperCase().regex(/^CLB-[0-9A-Z]{4,20}$/, "Order numbers look like CLB-260001234"),
    email: z.string().trim().max(320).nullable().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
  })
  .strict();
const listOrdersInput = z.object({}).strict();
const escalateInput = z
  .object({
    category: z.enum(["ORDER", "RETURN", "WARRANTY", "PAYMENT", "PRODUCT", "OTHER"]),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    subject: z.string().trim().min(3).max(200),
    summary: z.string().trim().min(10).max(4000),
    order_number: z.string().trim().toUpperCase().max(24).nullable().optional(),
    contact_email: z.string().trim().max(320).nullable().optional(),
    contact_phone: z.string().trim().max(20).nullable().optional(),
  })
  .strict();

// ============================================================================ definitions (stable order: part of the cached prefix)

export const SUPPORT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_help_center",
    description:
      "Search Collab's help centre and product knowledge base (delivery options and charges, order statuses, returns, refunds, warranty, payments, invoices, sign-in, coupons, and product descriptions/specifications). Use it before answering any policy or product-detail question, even when you think you know the answer.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The customer's question rephrased as a search query." } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "search_products",
    description: "Find products in the live catalogue with their current price range, availability and product page link. Use for recommendations, comparisons, price and stock questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name, brand, category or feature, e.g. 'noise cancelling headphones'." },
        max_price_rupees: { type: ["integer", "null"], description: "Optional budget in whole rupees." },
        in_stock_only: { type: ["boolean", "null"], description: "Only return products that can be bought right now." },
      },
      required: ["query", "max_price_rupees", "in_stock_only"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "get_order_status",
    description:
      "Look up one order's status, items, tracking and refunds. Signed-in customers can look up their own orders by number. Guests must give BOTH the order number AND the email address or phone number used for that order; ask for whichever is missing before calling. Never guess order numbers.",
    input_schema: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "e.g. CLB-260001234" },
        email: { type: ["string", "null"], description: "Guests only: email used for the order." },
        phone: { type: ["string", "null"], description: "Guests only: phone used for the order (any format)." },
      },
      required: ["order_number", "email", "phone"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "list_my_orders",
    description: "List the signed-in customer's 10 most recent orders (number, date, status, total). Only works when the customer is signed in.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "escalate_to_human",
    description:
      "Hand the conversation to a human support agent and open a ticket. Use when: the customer asks for a person; a refund, replacement, return pickup, address change or cancellation must be actioned; an item arrived damaged, defective or wrong; there is a payment problem (money debited without an order, double charge); the customer is upset; or you cannot resolve the question with your tools. Write a complete hand-off summary so the agent does not need to re-ask anything.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["ORDER", "RETURN", "WARRANTY", "PAYMENT", "PRODUCT", "OTHER"] },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"], description: "URGENT only for payment problems or safety issues." },
        subject: { type: "string", description: "One line, e.g. 'Damaged screen on delivery - CLB-260001234'." },
        summary: { type: "string", description: "What happened, what the customer wants, what you already checked, relevant order numbers." },
        order_number: { type: ["string", "null"] },
        contact_email: { type: ["string", "null"], description: "Guests: where the agent can reply." },
        contact_phone: { type: ["string", "null"] },
      },
      required: ["category", "priority", "subject", "summary", "order_number", "contact_email", "contact_phone"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
];

// ============================================================================ implementations

const json = (value: unknown): ToolResult => ({ content: JSON.stringify(value) });
const error = (message: string): ToolResult => ({ content: JSON.stringify({ error: message }), isError: true });

async function searchHelpCenter(input: z.infer<typeof searchHelpInput>): Promise<ToolResult> {
  const hits = await searchKnowledge(input.query, 5);
  if (hits.length === 0) return json({ results: [], note: "Nothing relevant in the help centre. Do not invent policy; offer to connect the customer with a person." });
  return json({ results: hits.map((hit) => ({ title: hit.title, source: hit.sourceType, product_page: hit.productSlug ? `/products/${hit.productSlug}` : undefined, text: hit.content })) });
}

const PRODUCT_SELECT = {
  name: true,
  slug: true,
  summary: true,
  ratingAverage: true,
  ratingCount: true,
  brand: { select: { name: true } },
  category: { select: { name: true } },
  variants: { where: { deletedAt: null, isActive: true }, select: { title: true, priceMinor: true, inventory: { select: { quantityAvailable: true } } } },
} satisfies Prisma.ProductSelect;

async function searchProducts(input: z.infer<typeof searchProductsInput>): Promise<ToolResult> {
  const terms = input.query.split(/\s+/).filter((term) => term.length > 1).slice(0, 6);
  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    deletedAt: null,
    AND: terms.map((term) => ({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { summary: { contains: term, mode: "insensitive" } },
        { brand: { name: { contains: term, mode: "insensitive" } } },
        { category: { name: { contains: term, mode: "insensitive" } } },
      ],
    })),
  };
  let products = await db.product.findMany({
    where,
    orderBy: [{ salesCount: "desc" }],
    take: 12,
    select: PRODUCT_SELECT,
  });
  // Nothing matched every word: retry with any word.
  if (products.length === 0 && terms.length > 1) {
    products = await db.product.findMany({ where: { status: "ACTIVE", deletedAt: null, OR: where.AND as Prisma.ProductWhereInput[] }, orderBy: [{ salesCount: "desc" }], take: 12, select: PRODUCT_SELECT });
  }
  const maxMinor = input.max_price_rupees ? input.max_price_rupees * 100 : null;
  const results = products
    .map((product) => {
      const variants = product.variants.filter((variant) => (maxMinor === null || variant.priceMinor <= maxMinor) && (!input.in_stock_only || (variant.inventory?.quantityAvailable ?? 0) > 0));
      if (variants.length === 0) return null;
      const prices = variants.map((variant) => variant.priceMinor);
      const inStock = variants.filter((variant) => (variant.inventory?.quantityAvailable ?? 0) > 0);
      return {
        name: product.name,
        brand: product.brand.name,
        category: product.category.name,
        summary: product.summary?.slice(0, 200) ?? undefined,
        price: Math.min(...prices) === Math.max(...prices) ? formatMoney(Math.min(...prices)) : `${formatMoney(Math.min(...prices))} - ${formatMoney(Math.max(...prices))}`,
        availability: inStock.length === 0 ? "out of stock" : inStock.length === variants.length ? "in stock" : `${inStock.length} of ${variants.length} options in stock`,
        options: variants.slice(0, 6).map((variant) => variant.title),
        rating: product.ratingCount > 0 ? `${product.ratingAverage}/5 from ${product.ratingCount} reviews` : undefined,
        url: `/products/${product.slug}`,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  return json({ results, note: results.length === 0 ? "No matching products. Suggest browsing /catalog." : "Prices include GST and are live." });
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Guest proof of ownership: the order number alone is never enough, and neither is an email or
 * phone alone (there is no lookup by contact details). A guest must supply BOTH the order
 * number (to find the order) AND the email or phone on that order.
 */
export function guestOwnsOrder(owner: { email: string | null; phone: string | null }, proof: { email?: string | null; phone?: string | null }): boolean {
  const emailOk = Boolean(proof.email && owner.email && proof.email.trim().toLowerCase() === owner.email.toLowerCase());
  const phoneOk = Boolean(proof.phone && owner.phone && normalizePhone(proof.phone).length >= 10 && normalizePhone(proof.phone) === normalizePhone(owner.phone));
  return emailOk || phoneOk;
}

/** Failed and successful guest verifications both count: 8 tries per chat session per 15 minutes. */
const GUEST_LOOKUP_POLICY: RateLimitPolicy = { name: "ai-guest-order-lookup", limit: 8, windowMs: 15 * 60_000, failMode: "closed" };

async function getOrderStatus(input: z.infer<typeof orderStatusInput>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.user) {
    // Checked before touching the database, so the reply never reveals whether the number exists.
    if (!input.email?.trim() && !input.phone?.trim()) {
      return error("Guests must give the order number AND the email address or phone number used for that order. Ask for the missing detail; do not look anything up without it.");
    }
    const limit = await rateLimit(GUEST_LOOKUP_POLICY, `session:${ctx.sessionId}`);
    if (!limit.success) return error("Too many order lookups in this chat. Ask the customer to sign in to see their orders, or offer to connect them with the support team.");
  }
  const order = await db.order.findUnique({
    where: { orderNumber: input.order_number },
    include: {
      user: { select: { id: true, email: true, phone: true } },
      items: { select: { productName: true, variantTitle: true, quantity: true, refundedQuantity: true } },
      refunds: { select: { amountMinor: true, status: true, createdAt: true, processedAt: true } },
    },
  });
  const notFound = error("No order with that number matches these details. Ask the customer to check the number (it is in the confirmation email) and the email or phone used.");
  if (!order) return notFound;
  if (ctx.user) {
    if (order.userId !== ctx.user.id) return notFound;
  } else if (!guestOwnsOrder(order.user, input)) {
    return notFound;
  }
  const address = (order.shippingAddress ?? {}) as Record<string, unknown>;
  const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : undefined);
  return json({
    order_number: order.orderNumber,
    status: order.status,
    placed_on: date(order.placedAt ?? order.createdAt),
    total: formatMoney(order.totalMinor, order.currency),
    items: order.items.map((item) => ({ name: `${item.productName} (${item.variantTitle})`, quantity: item.quantity, refunded_quantity: item.refundedQuantity || undefined })),
    shipping: {
      method: order.shippingMethodName,
      // Never the street address, landmark, PIN code or phone: city only.
      delivering_to_city: typeof address.city === "string" ? address.city : undefined,
      estimated_delivery: date(order.estimatedDeliveryAt),
      scheduled_date: date(order.scheduledDeliveryDate),
      carrier: order.carrierName ?? undefined,
      tracking_number: order.trackingNumber ?? undefined,
      tracking_url: order.trackingUrl ?? undefined,
      shipped_on: date(order.shippedAt),
      delivered_on: date(order.deliveredAt),
    },
    cancelled: order.cancelledAt ? { on: date(order.cancelledAt), reason: order.cancelReason } : undefined,
    refunds: order.refunds.map((refund) => ({ amount: formatMoney(refund.amountMinor, order.currency), status: refund.status, requested_on: date(refund.createdAt), completed_on: date(refund.processedAt) })),
    invoice_available: Boolean(order.placedAt),
  });
}

async function listMyOrders(ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.user) return error("The customer is not signed in. Ask them to sign in, or to share an order number plus the email or phone used for it.");
  const orders = await db.order.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { orderNumber: true, createdAt: true, status: true, totalMinor: true, currency: true, _count: { select: { items: true } } },
  });
  return json({
    orders: orders.map((order) => ({ order_number: order.orderNumber, date: order.createdAt.toISOString().slice(0, 10), status: order.status, total: formatMoney(order.totalMinor, order.currency), items: order._count.items })),
  });
}

async function escalate(input: z.infer<typeof escalateInput>, ctx: ToolContext): Promise<ToolResult> {
  const session = await db.chatSession.findUniqueOrThrow({ where: { id: ctx.sessionId }, include: { ticket: { select: { ticketNumber: true } } } });
  if (session.ticket) {
    return { content: JSON.stringify({ ok: true, ticket_number: session.ticket.ticketNumber, note: "Already escalated; the team has the full conversation." }), escalated: { ticketNumber: session.ticket.ticketNumber } };
  }
  const order = input.order_number ? await db.order.findUnique({ where: { orderNumber: input.order_number }, select: { id: true, userId: true } }) : null;
  // Only link orders the signed-in customer owns (guests' claims are verified by the human agent).
  const orderId = order && ctx.user && order.userId === ctx.user.id ? order.id : null;
  const ticketNumber = `TKT-${randomBase32(8)}`;
  const contactEmail = ctx.user?.email ?? (input.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact_email) ? input.contact_email.toLowerCase() : null);
  const contactPhone = input.contact_phone && /^\+?[\d\s-]{8,20}$/.test(input.contact_phone) ? input.contact_phone.replace(/[\s-]/g, "").slice(0, 16) : null;
  const summary = input.order_number && !orderId ? `${input.summary}\n\nOrder number given by the customer (unverified): ${input.order_number}` : input.summary;

  await db.$transaction(async (tx) => {
    await tx.supportTicket.create({
      data: {
        ticketNumber,
        customerId: ctx.user?.id ?? null,
        orderId,
        chatSessionId: ctx.sessionId,
        category: input.category as TicketCategory,
        priority: input.priority as TicketPriority,
        subject: input.subject,
        summary,
        contactEmail,
        contactPhone,
      },
    });
    await tx.chatSession.update({ where: { id: ctx.sessionId }, data: { status: "ESCALATED", escalatedAt: new Date() } });
    await tx.adminAlert.createMany({
      data: [
        {
          type: "SUPPORT_ESCALATION",
          severity: input.priority === "URGENT" ? "CRITICAL" : input.priority === "HIGH" ? "WARNING" : "INFO",
          title: `${ticketNumber}: ${input.subject}`.slice(0, 200),
          message: summary.slice(0, 1000),
          entityType: "ChatSession",
          entityId: ctx.sessionId,
          dedupeKey: `escalation:${ctx.sessionId}`,
        },
      ],
      skipDuplicates: true,
    });
  });

  const templateData = { ticketNumber, priority: input.priority, subject: input.subject, summary: summary.slice(0, 1500), customerName: ctx.user?.name ?? "Guest", sessionId: ctx.sessionId };
  await Promise.allSettled(
    (env.ADMIN_ALERT_EMAILS ?? []).map((recipient) => queueNotification({ type: "SUPPORT_ESCALATION", channel: "EMAIL", recipient, templateData })),
  ).then((results) => results.forEach((result) => result.status === "rejected" && log.error({ err: result.reason }, "escalation email not queued")));

  return {
    content: JSON.stringify({ ok: true, ticket_number: ticketNumber, note: "A support agent will reply in this chat between 9am and 9pm IST, or by email." }),
    escalated: { ticketNumber },
  };
}

/** Validates model-supplied input (eager input streaming disables server-side validation) and runs the tool. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  // Tolerate case-only name mismatches.
  const tool = name.toLowerCase();
  try {
    switch (tool) {
      case "search_help_center": {
        const input = searchHelpInput.safeParse(rawInput);
        return input.success ? await searchHelpCenter(input.data) : error(`Invalid input: ${input.error.issues[0]?.message ?? "check the schema"}`);
      }
      case "search_products": {
        const input = searchProductsInput.safeParse(rawInput);
        return input.success ? await searchProducts(input.data) : error(`Invalid input: ${input.error.issues[0]?.message ?? "check the schema"}`);
      }
      case "get_order_status": {
        const input = orderStatusInput.safeParse(rawInput);
        return input.success ? await getOrderStatus(input.data, ctx) : error(`Invalid input: ${input.error.issues[0]?.message ?? "check the schema"}`);
      }
      case "list_my_orders": {
        const input = listOrdersInput.safeParse(rawInput ?? {});
        return input.success ? await listMyOrders(ctx) : error("list_my_orders takes no arguments");
      }
      case "escalate_to_human": {
        const input = escalateInput.safeParse(rawInput);
        return input.success ? await escalate(input.data, ctx) : error(`Invalid input: ${input.error.issues[0]?.message ?? "check the schema"}`);
      }
      default:
        return error(`Unknown tool "${name}". Available tools: ${SUPPORT_TOOLS.map((definition) => definition.name).join(", ")}.`);
    }
  } catch (failure) {
    log.error({ err: failure, tool: name }, "support tool failed");
    return error("The lookup failed for a technical reason. Apologise and offer to connect the customer with a person.");
  }
}
