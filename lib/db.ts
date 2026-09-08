import "server-only";
import postgres from "postgres";
import { databaseUrl } from "./env";

/**
 * A single postgres.js pool per server instance, created on first use.
 *
 * Lazy on purpose: `next build` imports every route module to read its runtime
 * exports, so a pool built at module scope would make the whole build fail on
 * any environment without DATABASE_URL — every Preview deployment, and any CI
 * job that only type-checks.
 *
 * `prepare: false` keeps us compatible with Supabase's transaction pooler
 * (pgbouncer), which is the connection string most deployments will use. The
 * pool is deliberately small: serverless instances are many and short lived,
 * and every classroom query is a sub-millisecond indexed lookup.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ccSql: postgres.Sql | undefined;
}

/**
 * Anything but a loopback host is assumed to need TLS.
 *
 * postgres.js defaults to `ssl: false` and only enables TLS if the URL happens
 * to carry sslmode, so relying on the connection string means one missing query
 * parameter ships an unencrypted link to a hosted database.
 */
function sslFor(url: string): postgres.Options<never>["ssl"] {
  const override = process.env.DATABASE_SSL?.trim();
  if (override === "disable") return false;
  if (override) return override as postgres.Options<never>["ssl"];

  try {
    const { hostname } = new URL(url);
    const local =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local");
    return local ? false : "require";
  } catch {
    return "require";
  }
}

function poolMax(): number {
  // `Number(undefined ?? 5)` is 5, but `Number("")` is 0 — and an empty value is
  // exactly what an operator produces by adding the key in a dashboard and
  // leaving the box blank. A pool of zero hangs every request, in production only.
  const parsed = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 5;
  return Math.min(parsed, 50);
}

function create(): postgres.Sql {
  const url = databaseUrl();
  return postgres(url, {
    max: poolMax(),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: sslFor(url),
    onnotice: () => {},
  });
}

let pool: postgres.Sql | undefined;

function connection(): postgres.Sql {
  if (globalThis.__ccSql) return globalThis.__ccSql;
  pool ??= create();
  // Avoid exhausting connections across hot reloads in development.
  if (process.env.NODE_ENV !== "production") globalThis.__ccSql = pool;
  return pool;
}

/**
 * The query interface, indistinguishable from a postgres.js instance at the
 * call site but connecting only when a query is actually issued.
 */
type AnyFn = (...args: unknown[]) => unknown;

export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  // `sql`...`` is a call, so tagged templates land here.
  apply(_target, _thisArg, args: unknown[]) {
    return (connection() as unknown as AnyFn)(...args);
  },
  // `sql.begin`, `sql.json`, `sql.unsafe` and friends land here.
  get(_target, property) {
    const instance = connection() as unknown as Record<PropertyKey, unknown>;
    const value = instance[property];
    return typeof value === "function" ? (value as AnyFn).bind(instance) : value;
  },
}) as postgres.Sql;

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
