import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { LockAcquisitionError, rateLimit, rateLimitHeaders, type RateLimitPolicy } from "@/lib/redis";
import { ApiError, Errors } from "./errors";

/** Body of every error response: `{ error: { code, message, details? }, requestId }`. */
export interface ErrorPayload {
  status: number;
  body: { error: { code: string; message: string; details?: unknown }; requestId: string };
  headers: Record<string, string>;
}

/** Maps any thrown value to a safe client payload. Unknown errors never leak internals. */
export function toErrorPayload(error: unknown, requestId: string): ErrorPayload {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details }, requestId },
      headers: error.headers ?? {},
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "invalid_request",
          message: "The request is invalid.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        requestId,
      },
      headers: {},
    };
  }
  if (error instanceof LockAcquisitionError) {
    return {
      status: 409,
      body: { error: { code: "busy", message: "Another request is in progress. Please retry." }, requestId },
      headers: { "Retry-After": "1" },
    };
  }
  logger.error({ err: error, requestId }, "unhandled API error");
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong. Please try again." }, requestId },
    headers: {},
  };
}

/** JSON response that is never cached by browsers or proxies. */
export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

export function errorResponse(error: unknown, requestId: string): NextResponse {
  const payload = toErrorPayload(error, requestId);
  return json(payload.body, { status: payload.status, headers: { ...payload.headers, "x-request-id": requestId } });
}

export interface RouteContext<P> {
  params: P;
  requestId: string;
}

/**
 * Wraps a Route Handler with request-id propagation and uniform error mapping.
 * Next.js 15 passes dynamic params as a Promise; they are awaited here.
 */
export function route<P extends Record<string, string> = Record<string, never>>(
  handler: (request: NextRequest, context: RouteContext<P>) => Promise<Response>,
) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    try {
      const params = await context.params;
      const response = await handler(request, { params, requestId });
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

const MAX_JSON_BYTES = 64 * 1024;

/** Reads and validates a JSON body (content-type, size and schema enforced). */
export async function readJson<T extends z.ZodType>(request: Request, schema: T, options: { maxBytes?: number } = {}): Promise<z.output<T>> {
  const maxBytes = options.maxBytes ?? MAX_JSON_BYTES;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected an application/json body.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw Errors.badRequest("invalid_json", "Request body is not valid JSON.");
  }
  return schema.parse(parsed);
}

/** Applies a rate-limit policy; throws 429 with standard headers when exceeded. */
export async function enforceRateLimit(policy: RateLimitPolicy, identifier: string): Promise<void> {
  const result = await rateLimit(policy, identifier);
  if (!result.success) {
    if (result.degraded) {
      throw Errors.unavailable();
    }
    throw Errors.tooManyRequests(rateLimitHeaders(result));
  }
}

/** Optional `Idempotency-Key` header (16-64 URL-safe characters). */
export function readIdempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) {
    throw Errors.badRequest("invalid_idempotency_key", "Idempotency-Key must be 16-64 letters, digits, _ or -.");
  }
  return key;
}
