import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import postgres from "postgres";
import { config } from "dotenv";

/**
 * Integration harness.
 *
 * Builds the app if needed, points it at a dedicated test database, and runs a
 * real Next.js server on a spare port. The tests then drive the product exactly
 * as a browser would — real HTTP, real cookies, real Postgres — because the
 * behaviour that matters here (authorisation, one-answer semantics, concurrent
 * writes) only exists once those layers are in play.
 *
 * Point CC_TEST_BASE_URL at an already-running server to skip the spawn.
 */
config({ path: ".env.local" });
config({ path: ".env" });

const bin = (...parts: string[]) => join(process.cwd(), "node_modules", ...parts);
/**
 * Package entry points are run with the current Node binary rather than through
 * npm or npx, which are .cmd shims on Windows that execFile cannot resolve.
 */
const NEXT_BIN = bin("next", "dist", "bin", "next");

const PORT = Number(process.env.CC_TEST_PORT ?? 3311);
export const BASE_URL = process.env.CC_TEST_BASE_URL ?? `http://127.0.0.1:${PORT}`;

function adminUrl(databaseUrl: string): { admin: string; database: string } {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, "") || "postgres";
  url.pathname = "/postgres";
  return { admin: url.toString(), database };
}

async function ensureTestDatabase(): Promise<string> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_URL must be set to run the integration tests. Copy .env.example to .env.local.",
    );
  }

  const target = new URL(base);
  const name = `${target.pathname.replace(/^\//, "") || "classroom_copilot"}_test`;
  target.pathname = `/${name}`;
  const testUrl = target.toString();

  const { admin } = adminUrl(base);
  const sql = postgres(admin, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const existing = await sql`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) {
      await sql.unsafe(`create database "${name}"`);
    }
  } finally {
    await sql.end();
  }

  // tsx's own entry point rather than npx, which is npx.cmd on Windows and
  // cannot be resolved by execFile without a shell.
  execFileSync(process.execPath, [bin("tsx", "dist", "cli.mjs"), "scripts/migrate.ts"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  return testUrl;
}

async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForServer(url: string, child: ChildProcess | null): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) {
      throw new Error(`Test server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 404) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Test server did not become ready at ${url}`);
}

export default async function globalSetup() {
  // When the suite is pointed at a server someone else started — the Workers
  // runtime, say — that server owns its database and has told us which one.
  // Recomputing it here would silently aim the tests that read the database
  // directly at a different one than the server under test is writing to.
  if (process.env.CC_TEST_BASE_URL) {
    if (!process.env.CC_TEST_DATABASE_URL) {
      process.env.CC_TEST_DATABASE_URL = await ensureTestDatabase();
    }
    return async () => {};
  }

  const testUrl = await ensureTestDatabase();
  process.env.CC_TEST_DATABASE_URL = testUrl;

  // A stale server left on the port would be silently tested instead of the
  // build under test, which is exactly the kind of false green that makes a
  // suite worthless. Refuse to continue rather than guess.
  if (await isListening(PORT)) {
    throw new Error(
      `Port ${PORT} is already in use. Stop the process listening there, or set ` +
        `CC_TEST_BASE_URL to test against it deliberately.`,
    );
  }

  // Always build. Testing whatever happens to be in .next means a green run can
  // reflect code that no longer exists — the same class of false confidence the
  // port check above exists to prevent, one step earlier.
  // CC_SKIP_BUILD=1 is for tight local iteration when nothing has changed.
  if (
    process.env.CC_SKIP_BUILD !== "1" ||
    !existsSync(join(process.cwd(), ".next", "BUILD_ID"))
  ) {
    execFileSync(process.execPath, [NEXT_BIN, "build"], { stdio: "inherit" });
  }

  // Spawn the server binary directly rather than through npx: an npx wrapper
  // becomes a parent process that survives being signalled, which would leave
  // an orphaned server holding the port after the run.
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      NODE_ENV: "production",
      // Every request in the suite comes from one address; the per-IP limits
      // exist to stop a flood in a real class, not to throttle the tests.
      CC_DISABLE_RATE_LIMIT: "1",
      // Pinned empty so the "AI is disabled" tests are deterministic. Without
      // this they inherit the developer's own key from .env.local and the
      // suite would make live, billable calls on some machines and not others.
      AI_API_KEY: "",
      APP_ORIGIN: BASE_URL,
      // The suites run over plain http on loopback.
      CC_ALLOW_INSECURE_COOKIES: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  try {
    await waitForServer(BASE_URL, child);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${(error as Error).message}\n${logs.join("")}`);
  }

  const stop = () => {
    if (child.exitCode !== null || child.pid === undefined) return;
    try {
      // Negative pid signals the whole process group.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };

  // Belt and braces: if the runner dies unexpectedly, do not leak the server.
  process.once("exit", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  return async () => {
    stop();
    for (let i = 0; i < 40 && child.exitCode === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (child.exitCode === null && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    // Node's fetch keeps sockets alive between requests; without closing the
    // pool the runner lingers after the last assertion.
    const dispatcher = (globalThis as { [k: string]: unknown })[
      Symbol.for("undici.globalDispatcher.1") as unknown as string
    ] as { close?: () => Promise<void> } | undefined;
    await dispatcher?.close?.().catch(() => {});
  };
}
