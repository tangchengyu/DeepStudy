import { beforeAll } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

beforeAll(async () => {
  if (env.TEST_MIGRATIONS) await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
