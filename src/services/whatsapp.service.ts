import { env } from "@/env";
import { hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { childLogger } from "@/lib/logger";

/**
 * WhatsApp Business Cloud API (Meta Graph API). Business-initiated messages must use
 * pre-approved templates; free-form text is only allowed inside the 24-hour customer-service
 * window, which this app never relies on. Template names and parameter order below must match
 * the templates approved in WhatsApp Manager (see docs/ARCHITECTURE.md -> WhatsApp templates).
 */

const log = childLogger({ service: "whatsapp" });
const GRAPH = "https://graph.facebook.com";

export interface WhatsAppTemplate {
  name: string;
  language: string;
  /** Body {{1}}, {{2}}, ... in order. */
  bodyParams: string[];
  /** Dynamic suffix of a URL button (e.g. the tracking path), if the template has one. */
  urlButtonParam?: string;
  /** Authentication templates: the one-time code for the copy-code button. */
  otpCode?: string;
}

export interface WhatsAppResult {
  providerMessageId: string;
  dryRun: boolean;
}

/** 4xx errors Meta documents as non-retryable (bad number, template mismatch, opted out...). */
export class PermanentWhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "PermanentWhatsAppError";
  }
}

// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const RETRYABLE_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

function toWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}

export async function sendWhatsAppTemplate(to: string, template: WhatsAppTemplate): Promise<WhatsAppResult> {
  const components: unknown[] = [];
  if (template.bodyParams.length > 0) {
    components.push({ type: "body", parameters: template.bodyParams.map((text) => ({ type: "text", text: text.slice(0, 1024) })) });
  }
  if (template.otpCode) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: template.otpCode }] });
  } else if (template.urlButtonParam) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: template.urlButtonParam.slice(0, 2000) }] });
  }
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaId(to),
    type: "template",
    template: { name: template.name, language: { code: template.language }, components },
  };

  if (env.NOTIFICATIONS_DRY_RUN) {
    log.info({ to, template: template.name, params: template.otpCode ? "[REDACTED]" : template.bodyParams }, "whatsapp (dry run - not sent)");
    return { providerMessageId: `dryrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, dryRun: true };
  }

  const response = await fetch(`${GRAPH}/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { messages?: Array<{ id: string }>; error?: { message?: string; code?: number; error_data?: { details?: string } } }
    | null;
  if (!response.ok || !payload?.messages?.[0]?.id) {
    const code = payload?.error?.code ?? null;
    const message = `WhatsApp ${response.status} (${code ?? "?"}): ${payload?.error?.message ?? "no message id"} ${payload?.error?.error_data?.details ?? ""}`.trim();
    if (response.status >= 400 && response.status < 500 && response.status !== 429 && !(code !== null && RETRYABLE_CODES.has(code))) {
      throw new PermanentWhatsAppError(message, code);
    }
    throw new Error(message);
  }
  return { providerMessageId: payload.messages[0].id, dryRun: false };
}

/** X-Hub-Signature-256: "sha256=" + hex HMAC of the raw body keyed with the Meta app secret. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(hmacSha256Hex(rawBody, env.WHATSAPP_APP_SECRET), header.slice("sha256=".length).trim().toLowerCase());
}
