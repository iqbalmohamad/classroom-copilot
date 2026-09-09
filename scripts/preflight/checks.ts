/**
 * The decidable half of the pre-deployment check.
 *
 * Everything here is a pure function so it can be tested without a Cloudflare
 * account, a network, or a Windows machine. `scripts/cf-preflight.ts` supplies
 * the I/O.
 */
import { join } from "node:path";

export type CheckStatus = "ok" | "warn" | "fail" | "unknown";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

/**
 * A check that could not be run is not a check that passed.
 *
 * "unknown" exists precisely so that an unreachable Cloudflare API, a missing
 * login or a wrangler that would not start cannot be reported as a clean bill
 * of health. Both it and "fail" stop the deployment.
 */
export function isBlocking(check: Check): boolean {
  return check.status === "fail" || check.status === "unknown";
}

export function summarise(results: Check[]): {
  blocking: Check[];
  exitCode: 0 | 1;
} {
  const blocking = results.filter(isBlocking);
  return { blocking, exitCode: blocking.length > 0 ? 1 : 0 };
}

// ------------------------------------------------------------------- JSONC

/**
 * Strips comments from JSONC without touching string contents.
 *
 * A naive stripper corrupts this file: `"postgresql://user@host/db"` contains
 * `//`, and cutting from there to the end of the line silently truncates the
 * connection string into invalid JSON.
 */
export function stripJsonComments(source: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Copy the escaped character verbatim so an escaped quote does not
        // look like the end of the string.
        if (next !== undefined) {
          out += next;
          i += 1;
        }
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  // Trailing commas are legal in JSONC and fatal to JSON.parse.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export interface WranglerConfig {
  name?: string;
  main?: string;
  compatibility_flags?: string[];
  vars?: Record<string, string>;
  hyperdrive?: { binding?: string; id?: string; localConnectionString?: string }[];
}

export function parseWranglerConfig(source: string): WranglerConfig {
  return JSON.parse(stripJsonComments(source)) as WranglerConfig;
}

// ------------------------------------------------------------------ checks

export const PLACEHOLDER_HYPERDRIVE_ID = "REPLACE_WITH_HYPERDRIVE_ID";

/** The command that creates a Hyperdrive config correctly. One source of truth. */
export const HYPERDRIVE_CREATE_HINT =
  'npx wrangler hyperdrive create classroom-copilot-db \\\n' +
  '      --connection-string="postgresql://USER:PASSWORD@HOST:5432/postgres" \\\n' +
  "      --caching-disabled";

/**
 * Everything decidable from the wrangler configuration alone.
 *
 * Returns the Hyperdrive id when one is usable, so the caller knows whether the
 * caching check can even be attempted — and can treat "no id to check" as
 * blocking rather than quietly skipping it.
 */
export function checkWranglerConfig(source: string): {
  results: Check[];
  hyperdriveId: string | null;
} {
  const results: Check[] = [];
  const add = (name: string, status: CheckStatus, detail: string) =>
    results.push({ name, status, detail });

  let config: WranglerConfig;
  try {
    config = parseWranglerConfig(source);
    add("wrangler.jsonc", "ok", "present and parses");
  } catch (error) {
    add(
      "wrangler.jsonc",
      "fail",
      `does not parse: ${(error as Error).message.split("\n")[0]}`,
    );
    return { results, hyperdriveId: null };
  }

  // --- Hyperdrive binding
  const binding = config.hyperdrive?.find((h) => h.binding === "HYPERDRIVE");
  let hyperdriveId: string | null = null;

  if (!config.hyperdrive || config.hyperdrive.length === 0) {
    add(
      "Hyperdrive binding",
      "fail",
      "absent. postgres.js cannot negotiate TLS on workerd, so a Worker cannot\n" +
        "  reach a hosted database without it. Create one with:\n    " +
        HYPERDRIVE_CREATE_HINT,
    );
  } else if (!binding) {
    add(
      "Hyperdrive binding",
      "fail",
      'a hyperdrive entry exists but none is bound as "HYPERDRIVE", which is the\n' +
        "  name lib/db.ts looks for.",
    );
  } else if (!binding.id || binding.id === PLACEHOLDER_HYPERDRIVE_ID) {
    add(
      "Hyperdrive binding",
      "fail",
      "still the placeholder id. Create one with:\n    " + HYPERDRIVE_CREATE_HINT,
    );
  } else {
    hyperdriveId = binding.id;
    add("Hyperdrive binding", "ok", "bound as HYPERDRIVE with a real id");
  }

  // --- nodejs_compat
  if (config.compatibility_flags?.includes("nodejs_compat")) {
    add("nodejs_compat flag", "ok", "set");
  } else {
    add(
      "nodejs_compat flag",
      "fail",
      "required by the OpenNext adapter and by postgres.js",
    );
  }

  // --- entry point
  if (config.main && config.main.includes(".open-next")) {
    add("Worker entry", "ok", config.main);
  } else {
    add("Worker entry", "fail", `main should point into .open-next, got ${config.main ?? "nothing"}`);
  }

  return { results, hyperdriveId };
}

/** APP_ORIGIN may legitimately be unknown before the first deploy. */
export function checkAppOrigin(config: WranglerConfig | null, env: NodeJS.ProcessEnv): Check {
  const fromConfig = config?.vars?.APP_ORIGIN?.trim();
  const fromEnv = env.APP_ORIGIN?.trim();
  const value = fromConfig || fromEnv;

  if (value) {
    return { name: "APP_ORIGIN", status: "ok", detail: value };
  }
  return {
    name: "APP_ORIGIN",
    status: "warn",
    detail:
      "not set. This is expected before the first deploy, because the hostname\n" +
      "  does not exist yet — but it must be set before the class, or join URLs\n" +
      "  and the QR code are built from request headers.\n" +
      '  Add it to the "vars" block in wrangler.jsonc and deploy again.',
  };
}

// ---------------------------------------------------- running wrangler

export interface Invocation {
  file: string;
  args: string[];
}

/**
 * How to run wrangler without a shell, on any platform.
 *
 * `execFileSync("npx", ...)` fails with ENOENT on Windows: `npx` there is
 * `npx.cmd`, and execFile does not resolve `.cmd` without a shell. Running the
 * package's own JS entry point with the current Node binary sidesteps the whole
 * problem and is identical on every platform.
 */
export function wranglerInvocation(root: string, args: string[], execPath: string): Invocation {
  return {
    file: execPath,
    args: [join(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...args],
  };
}

export function wranglerEntryPath(root: string): string {
  return join(root, "node_modules", "wrangler", "bin", "wrangler.js");
}

/**
 * Reads `wrangler whoami` output.
 *
 * Anything that is not a clear "you are logged in" is unknown, not ok: this
 * check exists to stop a deploy that would fail, and guessing defeats it.
 */
export function readWhoami(output: string): Check {
  if (/not authenticated/i.test(output)) {
    return {
      name: "Cloudflare login",
      status: "fail",
      detail: "not authenticated. Run: npx wrangler login",
    };
  }
  // wrangler prints the account table on success.
  const account = /│\s*(.+?)\s*│\s*[0-9a-f]{32}\s*│/.exec(output)?.[1]?.trim();
  if (account) {
    return { name: "Cloudflare login", status: "ok", detail: `account ${account}` };
  }
  if (/associated with the email|account id/i.test(output)) {
    return { name: "Cloudflare login", status: "ok", detail: "authenticated" };
  }
  return {
    name: "Cloudflare login",
    status: "unknown",
    detail:
      "wrangler ran but the result could not be read as authenticated.\n" +
      "  Treated as blocking: an unverified login is not a working login.\n" +
      "  Check manually with: npx wrangler whoami",
  };
}

/**
 * Reads `wrangler hyperdrive get <id>` output, which is the configuration as
 * JSON.
 *
 * Hyperdrive caches SQL responses by default, and this app re-reads one counter
 * about once a second to drive realtime. A cached read means the class keeps
 * seeing the previous question, with nothing in the logs to say so — so an
 * unreadable answer here is blocking too.
 *
 * Note that caching being on is not always spelled out: wrangler treats an
 * absent `disabled` key as enabled, so anything short of an explicit `true` is
 * a failure rather than a pass.
 */
export function readHyperdriveCaching(output: string, id: string): Check {
  const name = "Hyperdrive caching";
  const fix =
    "\n  Fix: npx wrangler hyperdrive update " + id + " --caching-disabled";

  const config = extractJson(output);
  if (config && typeof config === "object") {
    const caching = (config as { caching?: unknown }).caching;
    const disabled =
      caching && typeof caching === "object"
        ? (caching as { disabled?: unknown }).disabled
        : undefined;

    if (disabled === true) {
      return { name, status: "ok", detail: "disabled, as this app requires" };
    }
    if ("caching" in (config as object)) {
      return {
        name,
        status: "fail",
        detail:
          "enabled. Realtime updates will go stale mid-class." +
          (disabled === undefined
            ? " (No explicit setting means\n  enabled: Hyperdrive caches by default.)"
            : "") +
          fix,
      };
    }
  }

  // Fall back to reading the text, in case the output shape ever changes.
  if (/"disabled"\s*:\s*true/.test(output)) {
    return { name, status: "ok", detail: "disabled, as this app requires" };
  }
  if (/"disabled"\s*:\s*false/.test(output)) {
    return {
      name,
      status: "fail",
      detail: "enabled. Realtime updates will go stale mid-class." + fix,
    };
  }

  return {
    name,
    status: "unknown",
    detail:
      "could not read the caching setting from the Hyperdrive configuration.\n" +
      "  Treated as blocking, because caching left on breaks realtime silently.\n" +
      `  Check manually with: npx wrangler hyperdrive get ${id}`,
  };
}

/** Pulls the JSON object out of command output that may carry a banner around it. */
function extractJson(output: string): unknown {
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(output.slice(first, last + 1));
  } catch {
    return null;
  }
}
