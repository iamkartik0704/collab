import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same configuration as the app (the standalone server does not read .env itself).
if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * End-to-end tests for the admin portal. They run against a real stack (PostgreSQL, Redis,
 * MinIO from docker-compose.yml) with the seed applied: `npm run db:deploy && npm run db:seed`.
 *
 *   E2E build: NEXT_PUBLIC_APP_URL / APP_URL are inlined at build time, so build for the test
 *   origin:  APP_URL=http://localhost:3100 NEXT_PUBLIC_APP_URL=http://localhost:3100 npm run build
 *   npm run test:e2e                           serves .next/standalone (production build)
 *   E2E_DEV=1 npm run test:e2e                 against `next dev` (Strict Mode on)
 *
 * Tests share one database, so they run serially in a single worker.
 */
// 3100 by default so the suite never collides with a dev server on 3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.E2E_DEV ? `npx next dev -p ${PORT}` : "node .next/standalone/server.js",
        url: `${baseURL}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
        // The app's CSRF check compares Origin with APP_URL, so point it at the test port.
        env: { ALLOW_DRY_RUN_IN_PRODUCTION: "1", APP_URL: baseURL, NEXT_PUBLIC_APP_URL: baseURL, PORT: String(PORT), HOSTNAME: "localhost" },
      },
});
