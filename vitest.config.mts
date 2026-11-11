import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Unit tests cover pure logic; modules that read config get placeholders and nothing connects.
    env: { SKIP_ENV_VALIDATION: "1", AUTH_TOKEN_PEPPER: "unit-test-pepper-unit-test-pepper-0000", LOG_LEVEL: "silent" },
    coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/*.d.ts"] },
  },
});
