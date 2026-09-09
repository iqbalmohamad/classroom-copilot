import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { databaseUrl } from "./env";

/**
 * Database access, with two different connection lifetimes.
 *
 * **Node** (local development, and any long-lived server): one pool per
 * process, created on first use and reused across requests. This is the cheap,
 * obvious thing and it is what the test suites exercise.
 *
 * **Cloudflare Workers**: one connection per request, opened when the request
 * starts and closed when it ends. This is not a preference, it is a
 * requirement. A socket belongs to the I/O context of the request that opened
 * it, so a pooled connection reused by a later request never completes and the
 * runtime kills the invocation with "your Worker's code had hung". Reproduced
 * on workerd before this was written: exactly every other request returned 500.
 *
 * Call sites do not change. `sql` resolves to the request-scoped connection
 * when there is one, and to the process pool otherwise.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ccSql: postgres.Sql | undefined;
}

/** The documented way to detect workerd from inside a Worker. */
export function isWorkersRuntime(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator | undefined)?.userAgent === "Cloudflare-Workers"
  );
}

/**
 * Where this process gets its database connection.
 *
 * On Cloudflare Workers this is always Cloudflare Hyperdrive, and that is not a
 * preference. postgres.js negotiates TLS through `node:tls`, and workerd's
 * implementation rejects the options it passes:
 *
 *   ERR_OPTION_NOT_IMPLEMENTED: The options.rejectUnauthorized option is not
 *   implemented — at Object.connect (node-internal:internal_tls_wrap)
 *
 * Verified against workerd for ssl=require, true, prefer, allow and
 * verify-full: every one fails. A hosted database such as Supabase requires
 * TLS, so a Worker cannot reach it directly with this driver. Hyperdrive holds
 * the TLS session to the database and presents a plaintext endpoint inside
 * Cloudflare's network, which also gives us the connection pooling that a
 * per-request connection model would otherwise lack.
 */
interface Connection {
  url: string;
  ssl: postgres.Options<never>["ssl"];
}

function hyperdriveUrl(): string | null {
  if (!isWorkersRuntime()) return null;
  try {
    // Outside a Worker request context this throws, which is why it is guarded
    // above and caught here: the Node test suites must not need a Cloudflare
    // context to open a database connection.
    const env = getCloudflareContext().env as unknown as {
      HYPERDRIVE?: { connectionString?: string };
    };
    return env?.HYPERDRIVE?.connectionString ?? null;
  } catch {
    return null;
  }
}

function resolveConnection(): Connection {
  const viaHyperdrive = hyperdriveUrl();
  if (viaHyperdrive) {
    // The Worker-to-Hyperdrive hop stays inside Cloudflare and must be
    // plaintext; Hyperdrive encrypts the hop to the database.
    return { url: viaHyperdrive, ssl: false };
  }

  const url = databaseUrl();
  if (isWorkersRuntime() && sslFor(url) !== false) {
    throw new Error(
      "On Cloudflare Workers a TLS database connection must go through a " +
        "Hyperdrive binding: postgres.js cannot negotiate TLS on workerd. " +
        "Add a `hyperdrive` binding named HYPERDRIVE to wrangler.jsonc.",
    );
  }
  return { url, ssl: sslFor(url) };
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
      hostname.endsWith(".local") ||
      hostname.endsWith(".hyperdrive.local");
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

function client(max: number): postgres.Sql {
  const { url, ssl } = resolveConnection();
  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl,
    onnotice: () => {},
  });
}

// ------------------------------------------------------------ process pool

let pool: postgres.Sql | undefined;

function processPool(): postgres.Sql {
  if (globalThis.__ccSql) return globalThis.__ccSql;
  pool ??= client(poolMax());
  // Avoid exhausting connections across hot reloads in development.
  if (process.env.NODE_ENV !== "production") globalThis.__ccSql = pool;
  return pool;
}

// ---------------------------------------------------------- request scope

const requestScope = new AsyncLocalStorage<postgres.Sql>();

function connection(): postgres.Sql {
  const scoped = requestScope.getStore();
  if (scoped) return scoped;

  if (isWorkersRuntime()) {
    // Failing loudly beats hanging: a query outside a request scope on Workers
    // would otherwise reuse a dead socket and stall until the runtime kills it.
    throw new Error(
      "Database access outside a request scope on Workers. Wrap the handler in " +
        "withRequestDatabase() (lib/http.ts does this for every API route).",
    );
  }
  return processPool();
}

/**
 * A database scope for one unit of work.
 *
 * On Node this is a pass-through — the process pool is already correct. On
 * Workers it opens a dedicated connection and guarantees it is closed, which
 * is what keeps a class of forty from stranding sockets on the database.
 *
 * `max: 1` because a request-scoped connection has no reason to fan out, and
 * because a Worker invocation may hold only a small number of simultaneous
 * outbound connections. Queries that run under `Promise.all` are queued by
 * postgres.js rather than parallelised, which for indexed lookups costs
 * microseconds.
 */
export interface DatabaseScope<T> {
  run: <R>(fn: () => Promise<R>) => Promise<R>;
  end: () => Promise<void>;
  value?: T;
}

export function openDatabaseScope(): DatabaseScope<never> {
  if (!isWorkersRuntime()) {
    return { run: (fn) => fn(), end: async () => {} };
  }

  const scoped = client(1);
  return {
    run: (fn) => requestScope.run(scoped, fn),
    end: async () => {
      // Never let a teardown failure surface as a request failure; the socket
      // is going away with the invocation regardless.
      await scoped.end({ timeout: 5 }).catch(() => {});
    },
  };
}

/** Runs `fn` with a request-scoped connection, closing it afterwards. */
export async function withRequestDatabase<T>(fn: () => Promise<T>): Promise<T> {
  const scope = openDatabaseScope();
  try {
    return await scope.run(fn);
  } finally {
    await scope.end();
  }
}

// ------------------------------------------------------------------ facade

type AnyFn = (...args: unknown[]) => unknown;

/**
 * The query interface, indistinguishable from a postgres.js instance at the
 * call site but resolving the right connection at the moment of use.
 */
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
