import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { env } from "@/env";
import { Providers } from "@/components/providers";
import "./globals.css";

/**
 * Inter, self-hosted (src/app/fonts, SIL OFL 1.1 - see Inter-LICENSE.txt): one variable woff2
 * subset to Latin + Latin Extended-A + the Rupee sign, with the full 100-900 weight axis.
 * Self-hosting avoids build-time requests to Google Fonts (and Turbopack's next/font/google
 * failure on Google's `/l/font?kit=` URLs).
 */
const inter = localFont({
  src: "./fonts/InterVariable-subset.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Collab — Electronics, delivered", template: "%s | Collab" },
  description: "Flagship phones, laptops, audio, cameras and gaming — with official warranty and fast delivery across India.",
  openGraph: { siteName: "Collab", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

/**
 * Every page renders per request: the strict CSP carries a per-request nonce that Next.js
 * stamps on its inline scripts, which static HTML could not contain. Data stays fast through
 * the Redis cache layer.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
