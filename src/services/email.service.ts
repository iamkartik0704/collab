import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";

/**
 * Transactional email transport: Resend (default), SMTP (any provider, via nodemailer) or `log`
 * (development: prints instead of sending). NOTIFICATIONS_DRY_RUN forces log mode for every
 * provider. Callers pass an idempotency key so a retried job never sends twice where the
 * provider supports it (Resend); SMTP retries rely on the worker's SENT check.
 */

const log = childLogger({ service: "email" });

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Stable per logical message (NotificationLog id). */
  idempotencyKey: string;
  tags?: Record<string, string>;
}

export interface EmailResult {
  providerMessageId: string;
  provider: "resend" | "smtp" | "log";
}

/** Permanent failures (bad address, rejected content): retrying cannot succeed. */
export class PermanentEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmailError";
  }
}

const globalForEmail = globalThis as unknown as { __collabResend?: Resend; __collabSmtp?: Transporter };

function resend(): Resend {
  globalForEmail.__collabResend ??= new Resend(env.RESEND_API_KEY);
  return globalForEmail.__collabResend;
}

function smtp(): Transporter {
  globalForEmail.__collabSmtp ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    pool: true,
    maxConnections: 5,
  });
  return globalForEmail.__collabSmtp;
}

export function emailMode(): EmailResult["provider"] {
  return env.NOTIFICATIONS_DRY_RUN ? "log" : env.EMAIL_PROVIDER;
}

export async function sendEmail(message: OutgoingEmail): Promise<EmailResult> {
  const mode = emailMode();
  if (mode === "log") {
    log.info(
      { to: message.to, subject: message.subject, attachments: message.attachments?.map((a) => `${a.filename} (${a.content.length} B)`), text: message.text.slice(0, 2000) },
      "email (dry run - not sent)",
    );
    return { provider: "log", providerMessageId: `log-${message.idempotencyKey}` };
  }

  if (mode === "resend") {
    const { data, error } = await resend().emails.send(
      {
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
        ...(message.attachments?.length
          ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
          : {}),
        ...(message.tags ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value: value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) })) } : {}),
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (error || !data) {
      const text = `${error?.name ?? "resend_error"}: ${error?.message ?? "no response"}`;
      // 4xx validation errors are permanent; rate limits and 5xx are retried by the worker.
      if (error && ["validation_error", "invalid_from_address", "invalid_to_address", "missing_required_field"].includes(error.name)) {
        throw new PermanentEmailError(text);
      }
      throw new Error(text);
    }
    return { provider: "resend", providerMessageId: data.id };
  }

  try {
    const info = await smtp().sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      replyTo: env.EMAIL_REPLY_TO,
      subject: message.subject,
      html: message.html,
      text: message.text,
      messageId: `<${message.idempotencyKey}@${new URL(env.APP_URL).hostname}>`,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return { provider: "smtp", providerMessageId: info.messageId };
  } catch (error) {
    const code = (error as { responseCode?: number }).responseCode;
    if (code && code >= 500 && code < 600 && code !== 552) throw new PermanentEmailError(`SMTP ${code}: ${(error as Error).message}`);
    throw error;
  }
}
