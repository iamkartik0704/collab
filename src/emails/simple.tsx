import { Section, Text } from "react-email";
import { ButtonLink, EmailLayout, heading, palette, small, text } from "./layout";

export function OtpEmail({ appUrl, code, expiresInMinutes }: { appUrl: string; code: string; expiresInMinutes: number }) {
  return (
    <EmailLayout preview={`Your Collab sign-in code is ${code}`} appUrl={appUrl} footerNote="Someone (hopefully you) asked to sign in to Collab with this address. If it wasn't you, ignore this email.">
      <Text style={heading}>Your sign-in code</Text>
      <Text style={text}>Enter this code to finish signing in. It expires in {expiresInMinutes} minutes.</Text>
      <Text style={{ ...text, fontSize: "32px", lineHeight: "40px", fontWeight: 700, letterSpacing: "0.3em", margin: "8px 0 20px" }}>{code}</Text>
      <Text style={small}>Collab staff will never ask you for this code.</Text>
    </EmailLayout>
  );
}

export function StaffAlertEmail({ appUrl, title, lines, actionLabel, actionPath }: { appUrl: string; title: string; lines: string[]; actionLabel: string; actionPath: string }) {
  return (
    <EmailLayout preview={title} appUrl={appUrl} footerNote="You receive operational alerts because your address is listed in ADMIN_ALERT_EMAILS.">
      <Text style={{ ...heading, color: palette.danger }}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={index} style={text}>
          {line}
        </Text>
      ))}
      <Section style={{ marginTop: "16px" }}>
        <ButtonLink href={`${appUrl}${actionPath}`}>{actionLabel}</ButtonLink>
      </Section>
    </EmailLayout>
  );
}
