import "server-only";
import postgres from "postgres";
import { databaseUrl } from "./env";

/**
 * A single postgres.js pool per server instance.
 *
 * `prepare: false` keeps us compatible with Supabase's transaction pooler
 * (pgbouncer), which is the connection string most deployments will use.
 * The pool is deliberately small: serverless instances are many and short
 * lived, and every classroom query is a sub-millisecond indexed lookup.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ccSql: postgres.Sql | undefined;
}

function create(): postgres.Sql {
  return postgres(databaseUrl(), {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
}

export const sql: postgres.Sql = globalThis.__ccSql ?? create();

if (process.env.NODE_ENV !== "production") {
  // Avoid exhausting connections across hot reloads in development.
  globalThis.__ccSql = sql;
}

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
