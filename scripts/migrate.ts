/**
 * Minimal forward-only migration runner.
 *
 * Applies every db/migrations/*.sql file that has not been recorded yet, each
 * inside its own transaction. Run it with the same database role the
 * application uses (see the RLS note in 0001_init.sql).
 *
 *   npm run db:migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )`;

    const applied = new Set(
      (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(join(dir, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      process.stdout.write("ok\n");
      count += 1;
    }

    console.log(count === 0 ? "Database already up to date." : `Applied ${count} migration(s).`);
  } catch (error) {
    console.error("\nMigration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main();
