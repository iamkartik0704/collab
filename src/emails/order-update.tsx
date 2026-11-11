import { Column, Row, Section, Text } from "react-email";
import { ButtonLink, EmailLayout, heading, palette, small, text } from "./layout";

export type OrderUpdateKind = "ORDER_CONFIRMATION" | "ORDER_SHIPPED" | "OUT_FOR_DELIVERY" | "ORDER_DELIVERED" | "REFUND_ISSUED";

export interface OrderEmailProps {
  kind: OrderUpdateKind;
  appUrl: string;
  customerName: string;
  orderNumber: string;
  items: Array<{ name: string; variant: string; quantity: number; lineTotal: string }>;
  totals: { subtotal: string; discount: string | null; shipping: string; tax: string; total: string };
  address: string[];
  tracking: { carrier: string; number: string; url: string | null } | null;
  refundAmount: string | null;
  estimatedDelivery: string | null;
  hasInvoice: boolean;
}

export const ORDER_COPY: Record<OrderUpdateKind, { subject: (n: string) => string; title: string; intro: string }> = {
  ORDER_CONFIRMATION: { subject: (n) => `Order ${n} confirmed`, title: "Thanks for your order", intro: "Your payment went through and we have started preparing your order." },
  ORDER_SHIPPED: { subject: (n) => `Order ${n} has shipped`, title: "Your order is on its way", intro: "Your package has left our warehouse." },
  OUT_FOR_DELIVERY: { subject: (n) => `Order ${n} is out for delivery`, title: "Arriving today", intro: "Your package is out for delivery. Keep your phone handy for the courier." },
  ORDER_DELIVERED: { subject: (n) => `Order ${n} was delivered`, title: "Delivered", intro: "Your order has been delivered. We hope you enjoy it." },
  REFUND_ISSUED: { subject: (n) => `Refund for order ${n}`, title: "Your refund is on its way", intro: "We have issued a refund to your original payment method. Banks usually take 5-7 business days to show it." },
};

function Line({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <Row>
      <Column style={{ ...small, margin: "2px 0", color: strong ? palette.ink : palette.muted, fontWeight: strong ? 600 : 400 }}>{label}</Column>
      <Column align="right" style={{ ...small, margin: "2px 0", color: tone ?? palette.ink, fontWeight: strong ? 600 : 400 }}>
        {value}
      </Column>
    </Row>
  );
}

export function OrderUpdateEmail(props: OrderEmailProps) {
  const copy = ORDER_COPY[props.kind];
  const orderUrl = `${props.appUrl}/account/orders/${props.orderNumber}`;
  return (
    <EmailLayout preview={`${copy.title} - order ${props.orderNumber}`} appUrl={props.appUrl}>
      <Text style={heading}>{copy.title}</Text>
      <Text style={text}>Hi {props.customerName},</Text>
      <Text style={text}>{copy.intro}</Text>

      {props.refundAmount && (
        <Text style={{ ...text, fontSize: "18px", fontWeight: 600, color: palette.success }}>Refund: {props.refundAmount}</Text>
      )}

      {props.tracking && (props.kind === "ORDER_SHIPPED" || props.kind === "OUT_FOR_DELIVERY") && (
        <Section style={{ backgroundColor: palette.surface, borderRadius: "8px", padding: "14px 16px", margin: "0 0 16px" }}>
          <Text style={{ ...small, margin: 0 }}>Carrier</Text>
          <Text style={{ ...text, margin: "0 0 8px", fontWeight: 600 }}>
            {props.tracking.carrier} · {props.tracking.number}
          </Text>
          {props.tracking.url && <ButtonLink href={props.tracking.url}>Track your package</ButtonLink>}
        </Section>
      )}

      {props.estimatedDelivery && props.kind !== "ORDER_DELIVERED" && props.kind !== "REFUND_ISSUED" && (
        <Text style={small}>Estimated delivery: {props.estimatedDelivery}</Text>
      )}

      <Section style={{ border: `1px solid ${palette.line}`, borderRadius: "8px", padding: "16px", margin: "8px 0 16px" }}>
        <Text style={{ ...small, margin: "0 0 10px", fontWeight: 600, color: palette.ink }}>Order {props.orderNumber}</Text>
        {props.items.map((item, index) => (
          <Row key={index} style={{ padding: "6px 0", borderBottom: `1px solid ${palette.line}` }}>
            <Column>
              <Text style={{ ...small, margin: 0, color: palette.ink }}>
                {item.name} × {item.quantity}
              </Text>
              <Text style={{ ...small, margin: 0 }}>{item.variant}</Text>
            </Column>
            <Column align="right" style={{ ...small, margin: 0, color: palette.ink, verticalAlign: "top" }}>
              {item.lineTotal}
            </Column>
          </Row>
        ))}
        <Section style={{ paddingTop: "10px" }}>
          <Line label="Subtotal" value={props.totals.subtotal} />
          {props.totals.discount && <Line label="Discount" value={`−${props.totals.discount}`} tone={palette.success} />}
          <Line label="Shipping" value={props.totals.shipping} />
          <Line label="GST (included)" value={props.totals.tax} />
          <Line label="Total" value={props.totals.total} strong />
        </Section>
      </Section>

      {props.address.length > 0 && props.kind !== "REFUND_ISSUED" && (
        <>
          <Text style={{ ...small, margin: "0 0 4px", fontWeight: 600, color: palette.ink }}>Delivering to</Text>
          <Text style={small}>{props.address.join(", ")}</Text>
        </>
      )}

      {props.kind === "ORDER_CONFIRMATION" && props.hasInvoice && <Text style={small}>Your GST invoice is attached as a PDF.</Text>}

      <Section style={{ marginTop: "20px" }}>
        <ButtonLink href={orderUrl}>View your order</ButtonLink>
      </Section>
    </EmailLayout>
  );
}
