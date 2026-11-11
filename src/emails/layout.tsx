import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "react-email";
import type { ReactNode } from "react";

/**
 * Shared shell for every transactional email. Inline styles only (email clients ignore
 * stylesheets); 600px single column; system font stack; no remote images so nothing is blocked.
 */

export const palette = {
  ink: "#111111",
  muted: "#5f6368",
  line: "#e6e6e6",
  surface: "#f6f6f6",
  success: "#137333",
  danger: "#b3261e",
};

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const text = { fontFamily: font, fontSize: "15px", lineHeight: "24px", color: palette.ink, margin: "0 0 12px" } as const;
export const small = { ...text, fontSize: "13px", lineHeight: "20px", color: palette.muted } as const;
export const heading = { ...text, fontSize: "22px", lineHeight: "30px", fontWeight: 600, margin: "0 0 16px" } as const;

export function EmailLayout({ preview, appUrl, children, footerNote }: { preview: string; appUrl: string; children: ReactNode; footerNote?: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: palette.surface, margin: 0, padding: "24px 0" }}>
        <Container style={{ maxWidth: "600px", backgroundColor: "#ffffff", borderRadius: "10px", padding: "32px", border: `1px solid ${palette.line}` }}>
          <Text style={{ ...text, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 24px" }}>Collab</Text>
          {children}
          <Hr style={{ borderColor: palette.line, margin: "28px 0 16px" }} />
          <Section>
            <Text style={small}>
              {footerNote ?? "You are receiving this email because of activity on your Collab account."} Questions? Reply to this email or visit{" "}
              <Link href={`${appUrl}/support`} style={{ color: palette.ink }}>
                Collab support
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{ display: "inline-block", backgroundColor: palette.ink, color: "#ffffff", fontFamily: font, fontSize: "14px", fontWeight: 600, padding: "12px 22px", borderRadius: "6px", textDecoration: "none" }}
    >
      {children}
    </Link>
  );
}
