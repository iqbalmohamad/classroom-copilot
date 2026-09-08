import { defineConfig, devices } from "@playwright/test";

/**
 * Multi-client browser verification.
 *
 * These tests run a real instructor, several real learners on phone-sized
 * viewports and a real shared screen against one server, and assert that state
 * moves between them without anybody pressing reload. Unit and integration
 * tests cannot show that: only a browser can.
 */
const PORT = Number(process.env.CC_E2E_PORT ?? 3312);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const databaseUrl =
  process.env.CC_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/classroom_copilot")
    .replace(/(\/[^/?]+)(\?|$)/, "$1_e2e$2");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One room, several clients: the specs must not race each other.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "off",
    launchOptions: { args: ["--no-sandbox"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      NODE_ENV: "production",
      CC_DISABLE_RATE_LIMIT: "1",
      // The suites run over plain http on loopback.
      CC_ALLOW_INSECURE_COOKIES: "1",
    },
  },
});
