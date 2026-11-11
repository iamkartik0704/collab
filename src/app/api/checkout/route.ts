import { enforceRateLimit, json, readJson, route, toErrorPayload } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { sha256Hex, stableStringify } from "@/lib/crypto";
import { RateLimitPolicies } from "@/lib/redis";
import {
  abandonIdempotentRequest,
  beginIdempotentRequest,
  completeIdempotentRequest,
  parseIdempotencyKey,
} from "@/lib/security/idempotency";
import { Errors } from "@/lib/api/errors";
import { checkoutSchema } from "@/schemas/checkout";
import { startCheckout } from "@/server/orders/checkout.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout  (Idempotency-Key header required)
 * Creates the PENDING_PAYMENT order, reserves stock for 15 minutes and returns the payment
 * session for Stripe or Razorpay. Retrying with the same key returns the original response;
 * the order itself also carries a unique key, so a duplicate charge is impossible even if the
 * Redis record is lost.
 */
export const POST = route(async (request, { requestId }) => {
  const user = await requireUser();
  await enforceRateLimit(RateLimitPolicies.checkout, user.id);
  const key = parseIdempotencyKey(request.headers);
  const body = await readJson(request, checkoutSchema);

  const scope = `checkout:${user.id}`;
  const fingerprint = sha256Hex(stableStringify(body));
  const claim = await beginIdempotentRequest(scope, key, fingerprint);
  if (claim.kind === "replay") {
    return json(claim.body, { status: claim.status, headers: { "Idempotent-Replayed": "true" } });
  }
  if (claim.kind === "in_progress") {
    throw Errors.conflict("request_in_progress", "This checkout is already being processed.");
  }
  if (claim.kind === "mismatch") {
    throw Errors.unprocessable("idempotency_key_reused", "This Idempotency-Key was used with a different request.");
  }

  try {
    const result = await startCheckout({ ...body, userId: user.id, idempotencyKey: key });
    await completeIdempotentRequest(scope, key, claim.owner, fingerprint, 201, result);
    return json(result, { status: 201 });
  } catch (error) {
    const payload = toErrorPayload(error, requestId);
    if (payload.status >= 500 || payload.status === 409) {
      // Transient (provider down, lock busy): let the client retry with the same key.
      await abandonIdempotentRequest(scope, key, claim.owner);
    } else {
      await completeIdempotentRequest(scope, key, claim.owner, fingerprint, payload.status, payload.body);
    }
    return json(payload.body, { status: payload.status, headers: payload.headers });
  }
});
