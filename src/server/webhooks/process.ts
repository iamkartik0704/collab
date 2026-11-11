import type { WebhookSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { claimWebhookEvent, markWebhookFailed, markWebhookProcessed } from "./replay-guard";

export const MAX_WEBHOOK_BYTES = 1024 * 1024;

function respond(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function rejectWebhook(status: number, code: string): NextResponse {
  return respond(status, { error: { code } });
}

/**
 * Shared tail of every webhook route, after the signature has been verified:
 * replay guard -> dispatch -> mark processed. A thrown dispatch error returns 500 so the
 * provider redelivers; the FAILED row is reclaimed on that retry.
 */
export async function processVerifiedWebhook(
  source: WebhookSource,
  event: { id: string; type: string },
  rawBody: string,
  dispatch: () => Promise<string>,
): Promise<NextResponse> {
  const claim = await claimWebhookEvent(source, event.id, event.type, rawBody);
  if (claim === "duplicate") {
    return respond(200, { received: true, duplicate: true });
  }
  if (claim === "in_progress") {
    return respond(409, { error: { code: "event_in_progress" } });
  }
  try {
    const outcome = await dispatch();
    await markWebhookProcessed(source, event.id);
    logger.info({ source, eventId: event.id, eventType: event.type, outcome }, "webhook processed");
    return respond(200, { received: true, outcome });
  } catch (error) {
    await markWebhookFailed(source, event.id, error);
    logger.error({ err: error, source, eventId: event.id, eventType: event.type }, "webhook processing failed");
    return respond(500, { error: { code: "processing_failed" } });
  }
}

/** Reads the raw body (needed byte-for-byte for HMAC) with a size cap. */
export async function readRawBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return null;
  const body = await request.text();
  return Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BYTES ? null : body;
}
