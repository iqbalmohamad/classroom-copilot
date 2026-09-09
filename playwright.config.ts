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
/**
 * Point CC_E2E_BASE_URL at an already-running server to test something other
 * than a local `next start` — in particular a Cloudflare Worker under workerd,
 * which is the only way to get browser-level evidence that the deployment
 * target actually works. That server owns its own database, so the setup that
 * creates and migrates one is skipped.
 */
const EXTERNAL = process.env.CC_E2E_BASE_URL?.trim();
const BASE_URL = EXTERNAL || `http://127.0.0.1:${PORT}`;

const databaseUrl =
  process.env.CC_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/classroom_copilot")
    .replace(/(\/[^/?]+)(\?|$)/, "$1_e2e$2");

export default defineConfig({
  testDir: "./e2e",
  // Creates and migrates the suite's own database, and rebuilds, so a green run
  // always reflects the code in the working tree. Skipped when testing an
  // external server, which brings its own.
  globalSetup: EXTERNAL ? undefined : "./e2e/global-setup.ts",
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
  webServer: EXTERNAL
    ? undefined
    : {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      APP_ORIGIN: BASE_URL,
      NODE_ENV: "production",
      CC_DISABLE_RATE_LIMIT: "1",
      AI_API_KEY: "",
      // The suites run over plain http on loopback.
      CC_ALLOW_INSECURE_COOKIES: "1",
    },
      },
});
