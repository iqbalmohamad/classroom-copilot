import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Workers connection-lifetime contract.
 *
 * On Cloudflare Workers a socket belongs to the request that opened it, so the
 * app must never reach the database outside a request scope. Getting this wrong
 * does not fail loudly on its own — it hangs the invocation and the runtime
 * kills it — so the rule is pinned here as well as exercised by
 * `npm run test:workers`.
 */
async function loadDb(userAgent?: string) {
  vi.resetModules();
  if (userAgent === undefined) {
    vi.stubGlobal("navigator", undefined);
  } else {
    vi.stubGlobal("navigator", { userAgent });
  }
  return import("@/lib/db");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("database scope", () => {
  it("does not think it is on Workers under Node", async () => {
    const db = await loadDb(undefined);
    expect(db.isWorkersRuntime()).toBe(false);
  });

  it("detects workerd by its user agent", async () => {
    const db = await loadDb("Cloudflare-Workers");
    expect(db.isWorkersRuntime()).toBe(true);
  });

  it("is a pass-through on Node, where the process pool is already correct", async () => {
    const db = await loadDb(undefined);
    const scope = db.openDatabaseScope();
    await expect(scope.run(async () => "ran")).resolves.toBe("ran");
    await expect(scope.end()).resolves.toBeUndefined();
  });

  it("refuses a query made outside a request scope on Workers", async () => {
    const db = await loadDb("Cloudflare-Workers");
    // Reaching the database here would reuse a socket from another request and
    // hang the invocation, so it must throw instead — loudly and immediately.
    expect(() => db.sql`select 1`).toThrow(/outside a request scope/i);
  });
});
