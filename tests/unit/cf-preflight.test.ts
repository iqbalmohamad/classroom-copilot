import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HYPERDRIVE_CREATE_HINT,
  PLACEHOLDER_HYPERDRIVE_ID,
  checkAppOrigin,
  checkWranglerConfig,
  isBlocking,
  readHyperdriveCaching,
  readWhoami,
  stripJsonComments,
  summarise,
  wranglerInvocation,
  type Check,
} from "@/scripts/preflight/checks";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

const of = (results: Check[], name: string) => results.find((r) => r.name === name)!;

const VALID = `{
  // a comment
  "main": ".open-next/worker.js",
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "0123456789abcdef0123456789abcdef" }],
}`;

describe("JSONC parsing", () => {
  it("does not treat // inside a string as a comment", () => {
    // The real file carries a connection string. A naive stripper cuts it in
    // half at the scheme separator and the whole check then reports a config
    // error that does not exist.
    const source = '{ "url": "postgresql://user@host:5432/db" } // trailing';
    expect(JSON.parse(stripJsonComments(source))).toEqual({
      url: "postgresql://user@host:5432/db",
    });
  });

  it("handles escaped quotes, block comments and trailing commas", () => {
    const source = `{
      /* block */
      "a": "say \\"hi\\" // not a comment",
      "b": [1, 2,],
    }`;
    expect(JSON.parse(stripJsonComments(source))).toEqual({
      a: 'say "hi" // not a comment',
      b: [1, 2],
    });
  });

  it("parses the wrangler configuration that ships with the repository", () => {
    const { results } = checkWranglerConfig(readFileSync("wrangler.jsonc", "utf8"));
    expect(of(results, "wrangler.jsonc").status).toBe("ok");
    expect(of(results, "nodejs_compat flag").status).toBe("ok");
    expect(of(results, "Worker entry").status).toBe("ok");
  });
});

describe("configuration checks", () => {
  it("accepts a complete configuration", () => {
    const { results, hyperdriveId } = checkWranglerConfig(VALID);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(hyperdriveId).toBe("0123456789abcdef0123456789abcdef");
  });

  it("blocks on the placeholder Hyperdrive id and offers the create command", () => {
    const source = VALID.replace("0123456789abcdef0123456789abcdef", PLACEHOLDER_HYPERDRIVE_ID);
    const { results, hyperdriveId } = checkWranglerConfig(source);
    expect(of(results, "Hyperdrive binding").status).toBe("fail");
    expect(of(results, "Hyperdrive binding").detail).toContain("--caching-disabled");
    expect(hyperdriveId).toBeNull();
  });

  it("blocks when nodejs_compat is missing", () => {
    const source = VALID.replace('["nodejs_compat"]', "[]");
    const { results } = checkWranglerConfig(source);
    expect(of(results, "nodejs_compat flag").status).toBe("fail");
  });

  it("blocks when no binding is named HYPERDRIVE", () => {
    const source = VALID.replace('"HYPERDRIVE"', '"DB"');
    const { results, hyperdriveId } = checkWranglerConfig(source);
    expect(of(results, "Hyperdrive binding").status).toBe("fail");
    expect(hyperdriveId).toBeNull();
  });

  it("blocks rather than throwing on an unparseable file", () => {
    const { results } = checkWranglerConfig("{ not json");
    expect(of(results, "wrangler.jsonc").status).toBe("fail");
  });

  it("only warns about APP_ORIGIN, which cannot be known before the first deploy", () => {
    expect(checkAppOrigin(null, EMPTY_ENV).status).toBe("warn");
    expect(checkAppOrigin({ vars: { APP_ORIGIN: "https://x.dev" } }, EMPTY_ENV).status).toBe("ok");
  });

  it("documents the same create command the README does", () => {
    const readme = readFileSync("README.md", "utf8");
    for (const fragment of ["hyperdrive create classroom-copilot-db", "--caching-disabled"]) {
      expect(HYPERDRIVE_CREATE_HINT).toContain(fragment);
      expect(readme).toContain(fragment);
      expect(readFileSync("wrangler.jsonc", "utf8")).toContain(fragment);
    }
  });
});

describe("unverified is not the same as passing", () => {
  it("treats an unreadable whoami as blocking", () => {
    const check = readWhoami("Proxy error: could not reach api.cloudflare.com");
    expect(check.status).toBe("unknown");
    expect(isBlocking(check)).toBe(true);
    expect(check.detail).toMatch(/blocking/i);
  });

  it("reads a real login and a real logout correctly", () => {
    expect(readWhoami("You are not authenticated.").status).toBe("fail");
    expect(
      readWhoami("│ Teacher Account │ 0123456789abcdef0123456789abcdef │").status,
    ).toBe("ok");
  });

  it("treats an unreadable Hyperdrive answer as blocking", () => {
    const check = readHyperdriveCaching("Authentication error [code: 10000]", "abc");
    expect(check.status).toBe("unknown");
    expect(isBlocking(check)).toBe(true);
  });

  it("reads a real `hyperdrive get` payload, banner and all", () => {
    // The command prints the configuration as JSON.
    const payload = `\u26c5\ufe0f wrangler 4.130.0
{
  "id": "0123456789abcdef0123456789abcdef",
  "name": "classroom-copilot-db",
  "origin": { "host": "db.example.supabase.co", "port": 5432 },
  "caching": { "disabled": true }
}`;
    expect(readHyperdriveCaching(payload, "abc").status).toBe("ok");
  });

  it("counts an absent `disabled` key as caching left on", () => {
    // Hyperdrive caches by default; wrangler itself renders undefined as
    // "enabled". Reading that as a pass would ship a room that shows the class
    // the previous question.
    const on = readHyperdriveCaching('{ "id": "x", "caching": { "max_age": 60 } }', "abc");
    expect(on.status).toBe("fail");
    expect(on.detail).toContain("--caching-disabled");
  });

  it("reads the caching setting when it is present", () => {
    expect(readHyperdriveCaching('"caching": { "disabled": true }', "abc").status).toBe("ok");
    const on = readHyperdriveCaching('"caching": { "disabled": false }', "abc");
    expect(on.status).toBe("fail");
    expect(on.detail).toContain("--caching-disabled");
  });

  it("exits nonzero for unknown as well as fail, and zero for warn", () => {
    const unknown: Check = { name: "n", status: "unknown", detail: "" };
    const warn: Check = { name: "n", status: "warn", detail: "" };
    const ok: Check = { name: "n", status: "ok", detail: "" };

    expect(summarise([ok, unknown]).exitCode).toBe(1);
    expect(summarise([ok, { name: "n", status: "fail", detail: "" }]).exitCode).toBe(1);
    expect(summarise([ok, warn]).exitCode).toBe(0);
    expect(summarise([ok, warn]).blocking).toEqual([]);
  });
});

describe("running wrangler on any platform", () => {
  it("runs the package entry point with node instead of npx", () => {
    // execFileSync("npx", ...) fails with ENOENT on Windows, where npx is
    // npx.cmd and execFile will not resolve it without a shell.
    const call = wranglerInvocation("C:\\repo", ["whoami"], "C:\\Program Files\\node.exe");
    expect(call.file).toBe("C:\\Program Files\\node.exe");
    expect(call.args[0]).toMatch(/wrangler[\\/]bin[\\/]wrangler\.js$/);
    expect(call.args).toContain("whoami");
    expect(JSON.stringify(call)).not.toContain("npx");
  });
});
