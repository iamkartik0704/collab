import { z } from "zod";
import { json, readJson, route } from "@/lib/api/handler";
import { requestOtp } from "@/lib/auth/otp";
import { getClientIp } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  target: z.string().trim().min(3).max(320),
});

/**
 * POST /api/auth/otp/request - sends a 6-digit login code by email or WhatsApp.
 * Verification happens through Auth.js: signIn("otp", { channel, target, code }).
 * Limits: 5 requests / 10 min / IP and 3 / 10 min / destination.
 */
export const POST = route(async (request) => {
  const body = await readJson(request, bodySchema);
  const result = await requestOtp({ ...body, ip: getClientIp(request.headers) });
  return json({ sent: true, expiresInSeconds: result.expiresInSeconds }, { status: 202 });
});
