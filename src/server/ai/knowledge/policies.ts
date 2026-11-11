import type { KnowledgeSourceType } from "@prisma/client";

/**
 * Store policies and FAQs for the support agent's RAG index. Keep these in sync with the
 * customer-facing /support page and the shipping methods in the database: the agent quotes
 * them as fact. Editing this file and running the worker (or `reindex-all`) re-embeds only the
 * documents whose text changed.
 */

export interface PolicyDocument {
  sourceType: Exclude<KnowledgeSourceType, "PRODUCT">;
  sourceId: string;
  title: string;
  content: string;
}

export const POLICY_DOCUMENTS: PolicyDocument[] = [
  {
    sourceType: "SHIPPING_POLICY",
    sourceId: "shipping-options",
    title: "Delivery options, charges and timelines",
    content: `Collab ships across India from our warehouse in Bengaluru.
- Free Standard Delivery: free on orders of ₹999 and above, otherwise ₹99. Arrives in 4-7 business days.
- Express Priority Delivery: ₹299. Arrives in 1-2 business days in serviceable PIN codes.
- Scheduled Delivery: ₹199. Choose a delivery date up to 14 days ahead and a 3-hour time slot.
Business days exclude Sundays and national holidays. The estimated delivery date is shown at checkout and in the order confirmation email.
Tracking: when an order ships, the customer receives the courier name, tracking number and a tracking link by email (and WhatsApp if they opted in). Couriers we use include Delhivery, Blue Dart and Ekart.
Address changes are possible until the order is packed; after that the parcel cannot be redirected.`,
  },
  {
    sourceType: "SHIPPING_POLICY",
    sourceId: "order-lifecycle",
    title: "Order statuses explained",
    content: `Awaiting payment: checkout started; items are reserved for 15 minutes while the customer pays. If payment does not complete in time, the reservation is released automatically and no money is taken.
Placed: payment confirmed by the bank / payment provider.
Confirmed: the order has been checked by our team.
Packed: the order is packed and waiting for courier pickup.
Shipped: handed to the courier; tracking is available.
Out for delivery: the courier will deliver today.
Delivered: the courier has delivered the parcel.
Cancelled: the order was cancelled; any payment is refunded automatically.
Payment failed: the payment did not go through; no money was taken (if money was debited, banks reverse it within 5-7 business days).
Returned: the items came back to us.`,
  },
  {
    sourceType: "RETURN_POLICY",
    sourceId: "returns-and-refunds",
    title: "Returns, replacements and refunds",
    content: `Unopened products in their original packaging can be returned within 7 days of delivery.
Defective, damaged or wrong items are replaced or refunded in full; report them within 48 hours of delivery with photos of the item and the box.
Opened products that are not defective cannot be returned, except where the manufacturer's warranty applies.
To start a return, the customer contacts support with the order number; we arrange a free pickup.
Refunds go back to the original payment method within 5-7 business days after the returned item passes inspection. UPI refunds are usually faster.
Orders can be cancelled free of charge until they are packed; a paid order cancelled before dispatch is refunded in full automatically.
Coupon discounts are not refunded as cash: the refund is the amount actually paid.`,
  },
  {
    sourceType: "WARRANTY_POLICY",
    sourceId: "warranty",
    title: "Warranty and service",
    content: `Every product sold by Collab is genuine and covered by the manufacturer's official warranty for India. The warranty period is listed on each product page (most phones and laptops: 12 months).
Warranty claims are handled by the brand's authorised service centres. The Collab GST tax invoice is the proof of purchase; customers can download it from their account (Orders -> Invoice) at any time.
Physical damage, liquid damage and unauthorised repairs are not covered by manufacturer warranties.
For a device that is dead on arrival (stops working within 7 days of delivery), Collab arranges a replacement directly instead of a service-centre visit.`,
  },
  {
    sourceType: "FAQ",
    sourceId: "payments",
    title: "Payments, invoices and security",
    content: `Accepted payment methods: credit and debit cards (processed by Stripe), UPI, NetBanking and wallets (processed by Razorpay). Collab never sees or stores full card numbers.
Prices include GST. A GST tax invoice is issued for every paid order, attached to the order confirmation email and downloadable from the account page.
If money was debited but the order shows "Payment failed" or "Awaiting payment", the payment provider either completes the order within minutes or the bank reverses the debit automatically within 5-7 business days. Customers should not pay twice; support can check the payment.
Cash on delivery is not available.`,
  },
  {
    sourceType: "FAQ",
    sourceId: "account-and-login",
    title: "Account, sign-in and notifications",
    content: `Customers sign in with a one-time code sent by email or WhatsApp, or with Google. There are no passwords. Codes expire after 5 minutes; Collab staff will never ask for a code.
Order updates are sent by email by default. WhatsApp updates require opting in from the account page.
The account page shows recent orders, saved addresses and invoices. Wishlist items are saved to the account when signed in.`,
  },
  {
    sourceType: "FAQ",
    sourceId: "coupons",
    title: "Coupons and offers",
    content: `Coupon codes are applied in the cart; the discount is validated and shown before payment. Only one coupon can be used per order.
Some coupons are limited to first orders, a minimum cart value, specific categories or brands, or a number of uses. If a coupon does not apply, the cart explains why.
WELCOME10 gives 10% off a first order (up to ₹2,000). Current promotions are listed on the Deals page.`,
  },
];
