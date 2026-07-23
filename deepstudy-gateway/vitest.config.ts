import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const projectDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          ENVIRONMENT: "development",
          GATEWAY_SECRET: "test-gateway-secret-at-least-32-characters",
          FIREBASE_WEB_API_KEY: "local-test-firebase-key",
          ALLOWED_ORIGINS: "https://app.test,https://localhost,capacitor://localhost",
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TURNSTILE_ALLOWED_HOSTNAMES: "localhost",
          RECOVERY_CODE_PEPPER: "test-recovery-code-pepper-at-least-32-characters",
          TEST_MIGRATIONS: await readD1Migrations(path.join(projectDir, "migrations"))
        }
      }
    }))
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false }
  }
});
