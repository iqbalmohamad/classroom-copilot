/**
 * Drops every application table and re-runs the migrations.
 * Development and test convenience only — never point this at production.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  if (/supabase\.(co|com)/.test(url) && process.env.ALLOW_REMOTE_RESET !== "yes") {
    console.error("Refusing to reset a hosted database. Set ALLOW_REMOTE_RESET=yes to override.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await sql.unsafe(`
    drop table if exists
      session_events, picks, question_votes, questions,
      poll_responses, polls, participants, rooms, schema_migrations
    cascade;
    drop function if exists cc_touch_room() cascade;
    drop function if exists cc_bump_room_version() cascade;
  `);
  await sql.end();
  console.log("Dropped application tables.");
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit" });
}

void main();
