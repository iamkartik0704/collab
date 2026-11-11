import Link from "next/link";
import { SocialIcon } from "@/components/shared/icons";
import { Logo } from "./logo";

const SERVICES = [
  { label: "Bonus program", href: "/support#bonus" },
  { label: "Gift cards", href: "/support#gift-cards" },
  { label: "Credit and payment", href: "/support#payment" },
  { label: "Service contracts", href: "/support#warranty" },
  { label: "Non-cash account", href: "/support#payment" },
  { label: "Payment", href: "/support#payment" },
];

const ASSISTANCE = [
  { label: "Find an order", href: "/account" },
  { label: "Terms of delivery", href: "/support#delivery" },
  { label: "Exchange and return of goods", href: "/support#returns" },
  { label: "Guarantee", href: "/support#warranty" },
  { label: "Frequently asked questions", href: "/support#faq" },
  { label: "Terms of use of the site", href: "/support#terms" },
];

const SOCIAL = [
  { network: "x" as const, label: "Collab on X", href: "https://x.com" },
  { network: "facebook" as const, label: "Collab on Facebook", href: "https://facebook.com" },
  { network: "tiktok" as const, label: "Collab on TikTok", href: "https://tiktok.com" },
  { network: "instagram" as const, label: "Collab on Instagram", href: "https://instagram.com" },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-white">
      <div className="container-site grid gap-12 py-14 md:grid-cols-[1.4fr_1fr_1fr] md:gap-28 md:py-[104px]">
        <div className="text-center md:text-left">
          <Logo tone="light" />
          <p className="mx-auto mt-6 max-w-[384px] text-sm leading-6 text-[#cfcfcf] md:mx-0">
            Collab curates the best technology on the planet — flagship phones, laptops, audio and gaming — delivered fast
            across India, backed by official warranty and real human support.
          </p>
        </div>
        <FooterColumn title="Services" links={SERVICES} />
        <FooterColumn title="Assistance to the buyer" links={ASSISTANCE} />
      </div>
      <div className="container-site flex flex-col items-center justify-between gap-6 pb-12 md:flex-row">
        <ul className="flex items-center gap-9" aria-label="Social media">
          {SOCIAL.map((item) => (
            <li key={item.network}>
              <a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={item.label} className="text-white/90 transition-colors hover:text-white">
                <SocialIcon network={item.network} />
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} Collab. All rights reserved.</p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ label: string; href: string }> }) {
  return (
    <div className="text-center md:text-left">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className="text-sm text-[#cfcfcf] transition-colors hover:text-white">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
