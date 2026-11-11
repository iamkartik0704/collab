import type { Metadata } from "next";
import { Bot, Mail, MessageCircle, Phone } from "lucide-react";
import { OpenChatButton } from "@/components/chat/support-chat";

export const metadata: Metadata = { title: "Support" };

const SECTIONS = [
  {
    id: "delivery",
    title: "Terms of delivery",
    body: "Free Standard Delivery on orders of ₹999 and above (4–7 business days). Express Priority Delivery arrives in 1–2 business days, and Scheduled Delivery lets you choose a date and a 3-hour slot up to 14 days ahead. You'll get tracking updates by email and, if you opt in, WhatsApp.",
  },
  {
    id: "returns",
    title: "Exchange and return of goods",
    body: "Unopened products can be returned within 7 days of delivery. Defective or damaged items are replaced or refunded in full. Start a return from your account; we arrange the pickup and refund to your original payment method within 5–7 business days of inspection.",
  },
  {
    id: "warranty",
    title: "Guarantee & service contracts",
    body: "Every product is genuine and covered by the manufacturer's official warranty (shown on each product page). Keep your Collab tax invoice — it is your proof of purchase for warranty claims at authorised service centres.",
  },
  {
    id: "payment",
    title: "Credit and payment",
    body: "Pay securely by credit or debit card, UPI, NetBanking or wallets. Card payments are processed by Stripe and UPI / NetBanking / wallets by Razorpay — Collab never sees or stores your card details. Prices include GST; a GST invoice is issued with every order.",
  },
  {
    id: "bonus",
    title: "Bonus program",
    body: "Collab members receive early access to sales and exclusive coupon codes. Apply coupon codes in your cart — the discount is validated and shown before you pay.",
  },
  {
    id: "gift-cards",
    title: "Gift cards",
    body: "Collab gift cards are coming soon. Until then, coupon codes from our promotions can be applied at checkout.",
  },
  {
    id: "faq",
    title: "Frequently asked questions",
    body: "How long are items held during checkout? Items are reserved for 15 minutes while you pay. Can I change my delivery address? Yes, until the order is packed — contact us with your order number. Is my order confirmed? You'll see a confirmation page and receive an email as soon as your bank confirms the payment.",
  },
  {
    id: "terms",
    title: "Terms of use of the site",
    body: "By using Collab you agree to purchase for personal use, to provide accurate delivery information, and not to misuse promotions. Product availability and prices may change; the price you pay is the one shown at checkout.",
  },
];

export default function SupportPage() {
  return (
    <div className="container-site py-14">
      <h1 className="text-3xl font-semibold">How can we help?</h1>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <li className="rounded-[var(--radius-card)] bg-ink text-white">
          <OpenChatButton className="flex h-full w-full items-center gap-3 p-5 text-left">
            <Bot className="size-6" aria-hidden />
            <span>
              <span className="block text-sm text-white/70">Chat with us</span>
              <span className="font-medium">Instant answers, 24/7</span>
            </span>
          </OpenChatButton>
        </li>
        <li className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-5">
          <Mail className="size-6" aria-hidden />
          <span>
            <span className="block text-sm text-muted-2">Email</span>
            <a href="mailto:support@collab.store" className="font-medium">
              support@collab.store
            </a>
          </span>
        </li>
        <li className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-5">
          <Phone className="size-6" aria-hidden />
          <span>
            <span className="block text-sm text-muted-2">Call (9am–9pm IST)</span>
            <a href="tel:+918000000000" className="font-medium">
              +91 80000 00000
            </a>
          </span>
        </li>
        <li className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-5">
          <MessageCircle className="size-6" aria-hidden />
          <span>
            <span className="block text-sm text-muted-2">WhatsApp</span>
            <span className="font-medium">Order updates & help</span>
          </span>
        </li>
      </ul>
      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-40">
            <h2 id={`${section.id}-title`} className="text-xl font-medium">
              {section.title}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-muted-2">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
