import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { config } from "dotenv";

/**
 * Prepares the browser suite: its own database, migrated, against a fresh build.
 *
 * Without this a clone would fail on a missing database, and — worse — the suite
 * would happily run against whatever was last compiled into .next, which is the
 * kind of green run that means nothing.
 */
config({ path: ".env.local" });
config({ path: ".env" });

export default async function globalSetup() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL must be set to run the browser suite.");

  const target = new URL(base);
  const name = `${target.pathname.replace(/^\//, "") || "classroom_copilot"}_e2e`;
  target.pathname = `/${name}`;
  const testUrl = target.toString();

  const admin = new URL(base);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, prepare: false, onnotice: () => {} });
  try {
    const existing = await sql`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end();
  }

  execFileSync("npx", ["tsx", "scripts/migrate.ts"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  if (process.env.CC_SKIP_BUILD !== "1") {
    execFileSync("npm", ["run", "build"], { stdio: "inherit" });
  }
}
