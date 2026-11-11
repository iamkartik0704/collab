/**
 * Cheap, deterministic checks around the support agent. They do not replace the model's own
 * judgement or the tools' authorisation; they keep obvious abuse out of the transcript and
 * flag sessions for review.
 */

export const MAX_USER_MESSAGE_CHARS = 2_000;
/** Customer turns per session; long sessions are handed to a person instead of growing forever. */
export const MAX_USER_TURNS = 40;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the)? ?(previous|prior|above) (instructions|prompts|rules)/i,
  /disregard (your|the) (instructions|system prompt|rules)/i,
  /(reveal|print|show|repeat) (your|the) (system prompt|instructions|hidden prompt)/i,
  /you are now (dan|in developer mode|an? unrestricted)/i,
  /<\/?(system|assistant|tool_result|function_calls)>/i,
  /\bact as (an? )?(admin|administrator|developer|staff)\b/i,
];

export interface GuardResult {
  text: string;
  flagged: boolean;
  reason: string | null;
}

/** Normalises the customer's message and flags likely prompt-injection attempts. */
export function inspectUserMessage(raw: string): GuardResult {
  // Strip control characters (keep newlines / tabs) and collapse runaway whitespace.
  const text = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_USER_MESSAGE_CHARS);
  const hit = INJECTION_PATTERNS.find((pattern) => pattern.test(text));
  return { text, flagged: Boolean(hit), reason: hit ? "possible prompt injection" : null };
}

/** Never let card numbers or one-time codes into model context or logs. */
export function redactSensitive(text: string): string {
  return text
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => (luhn(match.replace(/\D/g, "")) ? "[card number removed]" : match))
    .replace(/\b(otp|code|pin|cvv)\s*(is|:)?\s*\d{3,8}\b/gi, "$1 [removed]");
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}
