import { randomInt } from "node:crypto";
import type { OtpChannel } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import { env } from "@/env";
import { Errors } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/handler";
import { hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { db, isUniqueConstraintError } from "@/lib/db";
import { rateLimit, RateLimitPolicies, resetRateLimit, type RateLimitPolicy } from "@/lib/redis";
import { queueNotification } from "@/server/notifications/notify";
import type { SessionUser } from "./refresh-tokens";

/** Per-destination limit, independent of the per-IP auth limit (stops SMS/email bombing). */
const OTP_TARGET_POLICY: RateLimitPolicy = { name: "otp-target", limit: 3, windowMs: 10 * 60_000, failMode: "closed" };

const OTP_PURPOSE = "LOGIN" as const;

export class OtpVerificationError extends Error {
  constructor(readonly reason: "invalid" | "rate_limited" | "inactive") {
    super(`OTP verification failed: ${reason}`);
    this.name = "OtpVerificationError";
  }
}

/** Normalises an email (lower-case) or phone number (E.164, India default region). */
export function normalizeOtpTarget(channel: OtpChannel, raw: string): string {
  const value = raw.trim();
  if (channel === "EMAIL") {
    const parsed = z.email().safeParse(value.toLowerCase());
    if (!parsed.success) {
      throw Errors.badRequest("invalid_email", "Enter a valid email address.");
    }
    return parsed.data;
  }
  const phone = parsePhoneNumberFromString(value, "IN");
  if (!phone || !phone.isValid()) {
    throw Errors.badRequest("invalid_phone", "Enter a valid mobile number.");
  }
  return phone.number;
}

function otpDigest(channel: OtpChannel, target: string, code: string): string {
  return hmacSha256Hex(`otp:${channel}:${target}:${code}`);
}

/** Issues a 6-digit code and queues its delivery. Response is identical for known/unknown users. */
export async function requestOtp(input: { channel: OtpChannel; target: string; ip: string }): Promise<{ expiresInSeconds: number }> {
  const target = normalizeOtpTarget(input.channel, input.target);
  await enforceRateLimit(RateLimitPolicies.auth, `otp-request:${input.ip}`);
  await enforceRateLimit(OTP_TARGET_POLICY, `${input.channel}:${target}`);

  const ttlSeconds = env.OTP_TTL_SECONDS ?? 300;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  await db.$transaction([
    // Only the newest code is valid.
    db.otpCode.updateMany({
      where: { channel: input.channel, target, purpose: OTP_PURPOSE, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    db.otpCode.create({
      data: {
        channel: input.channel,
        target,
        purpose: OTP_PURPOSE,
        codeHash: otpDigest(input.channel, target, code),
        maxAttempts: env.OTP_MAX_ATTEMPTS ?? 5,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        ipHash: hmacSha256Hex(input.ip),
      },
    }),
  ]);

  await queueNotification({
    type: "OTP",
    channel: input.channel === "EMAIL" ? "EMAIL" : "WHATSAPP",
    recipient: target,
    templateData: { code, expiresInMinutes: Math.ceil(ttlSeconds / 60) },
    redactKeys: ["code"],
  });

  return { expiresInSeconds: ttlSeconds };
}

/**
 * Verifies a code and returns the (created-on-first-login) user. Each attempt is counted
 * atomically before comparison, so parallel guessing cannot exceed `maxAttempts`.
 */
export async function verifyOtp(input: { channel: OtpChannel; target: string; code: string; ip: string }): Promise<SessionUser> {
  if (!/^\d{6}$/.test(input.code)) {
    throw new OtpVerificationError("invalid");
  }
  let target: string;
  try {
    target = normalizeOtpTarget(input.channel, input.target);
  } catch {
    throw new OtpVerificationError("invalid");
  }

  const limit = await rateLimit(RateLimitPolicies.auth, `otp-verify:${input.ip}`);
  if (!limit.success) {
    throw new OtpVerificationError("rate_limited");
  }

  const otp = await db.otpCode.findFirst({
    where: { channel: input.channel, target, purpose: OTP_PURPOSE, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) {
    throw new OtpVerificationError("invalid");
  }

  const counted = await db.otpCode.updateMany({
    where: { id: otp.id, consumedAt: null, attempts: { lt: otp.maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0 || !safeEqual(otp.codeHash, otpDigest(input.channel, target, input.code))) {
    throw new OtpVerificationError("invalid");
  }

  const consumed = await db.otpCode.updateMany({
    where: { id: otp.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) {
    throw new OtpVerificationError("invalid");
  }

  const user = await findOrCreateVerifiedUser(input.channel, target);
  if (!user.isActive) {
    throw new OtpVerificationError("inactive");
  }
  await resetRateLimit(OTP_TARGET_POLICY, `${input.channel}:${target}`).catch(() => undefined);

  const { isActive: _isActive, ...sessionUser } = user;
  return sessionUser;
}

const USER_SELECT = { id: true, role: true, email: true, name: true, image: true, isActive: true } as const;

async function findOrCreateVerifiedUser(channel: OtpChannel, target: string) {
  const now = new Date();
  const where = channel === "EMAIL" ? { email: target } : { phone: target };
  const verified = channel === "EMAIL" ? { emailVerified: now } : { phoneVerified: now };
  try {
    return await db.user.upsert({
      where,
      create: { ...where, ...verified },
      update: verified,
      select: USER_SELECT,
    });
  } catch (error) {
    // Two first-time logins racing: the loser reads the winner's row.
    if (isUniqueConstraintError(error)) {
      return db.user.findUniqueOrThrow({ where, select: USER_SELECT });
    }
    throw error;
  }
}
