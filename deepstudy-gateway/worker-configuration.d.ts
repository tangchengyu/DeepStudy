interface DeepStudyBindings {
  DB: D1Database;
  ENVIRONMENT: "development" | "staging" | "production";
  GATEWAY_SECRET: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  ALLOWED_ORIGINS: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_ALLOWED_HOSTNAMES: string;
  RECOVERY_CODE_PEPPER: string;
  TEST_MIGRATIONS?: D1Migration[];
}

interface Env extends DeepStudyBindings {}

declare namespace Cloudflare {
  interface Env extends DeepStudyBindings {}
}
