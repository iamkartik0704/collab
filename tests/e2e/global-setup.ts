import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { closeDb, db, E2E_CUSTOMER_EMAIL, STAFF_EMAILS, type StaffRole } from "./support/db";

/**
 * Signs each seeded staff member in by minting the same Auth.js session JWT that
 * /api/auth/refresh issues (OTP and Google sign-in need a real inbox / Google account, which CI
 * does not have). Every request still goes through the normal middleware + server-side
 * permission checks; only the login step is skipped.
 */

export const AUTH_DIR = path.resolve(__dirname, ".auth");
export const storageStateFor = (role: StaffRole | "customer") => path.join(AUTH_DIR, `${role}.json`);

export default async function globalSetup(config: FullConfig): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set: run the e2e suite with the same .env as the app.");
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const { hostname, protocol } = new URL(baseURL);
  const secure = protocol === "https:";
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

  mkdirSync(AUTH_DIR, { recursive: true });
  try {
    await db().user.upsert({ where: { email: E2E_CUSTOMER_EMAIL }, create: { email: E2E_CUSTOMER_EMAIL, name: "E2E Customer", emailVerified: new Date() }, update: { isActive: true } });
    const accounts = [...(Object.entries(STAFF_EMAILS) as Array<[StaffRole, string]>), ["customer", E2E_CUSTOMER_EMAIL] as const];
    for (const [role, email] of accounts) {
      const user = await db().user.findUnique({ where: { email }, select: { id: true, name: true, email: true, image: true, role: true } });
      if (!user) throw new Error(`Seeded staff user ${email} not found. Run \`npm run db:seed\` first.`);
      const accessExp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
      const value = await encode({
        secret,
        salt: cookieName,
        maxAge: 2 * 60 * 60,
        token: { sub: user.id, name: user.name, email: user.email, picture: user.image, uid: user.id, role: user.role, sid: `e2e-${role}`, accessExp },
      });
      writeFileSync(
        storageStateFor(role),
        JSON.stringify({
          cookies: [{ name: cookieName, value, domain: hostname, path: "/", expires: accessExp, httpOnly: true, secure, sameSite: "Lax" }],
          origins: [],
        }),
      );
    }
  } finally {
    await closeDb();
  }
}
