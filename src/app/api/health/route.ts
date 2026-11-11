import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis, withRedisTimeout } from "@/lib/redis/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health - liveness + readiness for Docker / nginx / uptime checks.
 * `?live=1` answers without touching dependencies (container liveness); the default also checks
 * PostgreSQL and Redis and returns 503 when either is down (readiness).
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).searchParams.get("live") === "1") {
    return NextResponse.json({ status: "ok" }, { headers });
  }
  const check = async (name: string, probe: () => Promise<unknown>) => {
    const started = performance.now();
    try {
      await probe();
      return { name, ok: true, ms: Math.round(performance.now() - started) };
    } catch {
      return { name, ok: false, ms: Math.round(performance.now() - started) };
    }
  };
  const results = await Promise.all([
    check("postgres", () => Promise.race([db.$queryRaw`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000))])),
    check("redis", () => withRedisTimeout(redis.ping(), 1_000, "health ping")),
  ]);
  const ok = results.every((result) => result.ok);
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks: Object.fromEntries(results.map(({ name, ...rest }) => [name, rest])), version: process.env.APP_VERSION ?? "dev" },
    { status: ok ? 200 : 503, headers },
  );
}
