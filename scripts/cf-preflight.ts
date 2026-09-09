/**
 * Pre-deployment check for Cloudflare Workers.
 *
 * Catches the handful of mistakes that would otherwise be discovered by a class
 * of forty learners: a placeholder Hyperdrive id, Hyperdrive caching left on, a
 * missing public origin, a secret committed by accident, or a build that was
 * never produced.
 *
 *   npm run cf:check
 *
 * A check that could not be run exits nonzero. The decidable logic lives in
 * scripts/preflight/checks.ts so it can be tested; this file is the I/O.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkAppOrigin,
  checkWranglerConfig,
  parseWranglerConfig,
  readHyperdriveCaching,
  readWhoami,
  summarise,
  wranglerEntryPath,
  wranglerInvocation,
  type Check,
  type CheckStatus,
  type WranglerConfig,
} from "./preflight/checks";

const root = process.cwd();
const results: Check[] = [];
const add = (name: string, status: CheckStatus, detail: string) =>
  results.push({ name, status, detail });

/**
 * Runs wrangler without a shell and without npx.
 *
 * Returns null rather than throwing, because the caller decides what a failure
 * means — and for authentication and caching the answer is "blocking", not
 * "warning". stderr is folded into the output so wrangler's own explanation of
 * a refusal is available to the readers, which parse it; it is never printed
 * verbatim, since `hyperdrive get` echoes connection details.
 */
function wrangler(args: string[]): string | null {
  const entry = wranglerEntryPath(root);
  if (!existsSync(entry)) return null;
  const { file, args: argv } = wranglerInvocation(root, args, process.execPath);
  try {
    return execFileSync(file, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 90_000,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    }).toString();
  } catch (error) {
    const shell = error as { stdout?: Buffer; stderr?: Buffer };
    const combined = `${shell.stdout?.toString() ?? ""}\n${shell.stderr?.toString() ?? ""}`;
    // A refusal still carries the answer we need ("not authenticated"), so hand
    // it to the reader. Nothing at all means we learned nothing.
    return combined.trim() ? combined : null;
  }
}

// --- wrangler configuration -------------------------------------------------

let source = "";
let config: WranglerConfig | null = null;
let hyperdriveId: string | null = null;

try {
  source = readFileSync(join(root, "wrangler.jsonc"), "utf8");
} catch {
  add("wrangler.jsonc", "fail", "missing");
}

if (source) {
  const configChecks = checkWranglerConfig(source);
  results.push(...configChecks.results);
  hyperdriveId = configChecks.hyperdriveId;
  try {
    config = parseWranglerConfig(source);
  } catch {
    config = null;
  }
}

// --- secrets ----------------------------------------------------------------

if (existsSync(join(root, ".dev.vars"))) {
  let tracked = "";
  try {
    tracked = execFileSync("git", ["ls-files", "--error-unmatch", ".dev.vars"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    /* not tracked, which is what we want */
  }
  if (tracked.trim()) {
    add(".dev.vars", "fail", "is tracked by git. It holds local secrets; remove it from the index.");
  } else {
    add(".dev.vars", "ok", "present and untracked (local development only)");
  }
} else {
  add(".dev.vars", "warn", "absent — `wrangler dev` will have no local configuration");
}

// --- build output -----------------------------------------------------------

if (existsSync(join(root, ".open-next", "worker.js"))) {
  add("Worker bundle", "ok", ".open-next/worker.js present");
} else {
  add("Worker bundle", "warn", "not built yet — `npm run cf:build` produces it");
}

// --- authentication ---------------------------------------------------------

const whoami = wrangler(["whoami"]);
if (whoami === null) {
  add(
    "Cloudflare login",
    "unknown",
    "wrangler could not be run, so the login could not be checked.\n" +
      "  Treated as blocking: an unverified login is not a working login.\n" +
      "  Install dependencies with `npm ci`, then check with: npx wrangler whoami",
  );
} else {
  results.push(readWhoami(whoami));
}

// --- Hyperdrive caching -----------------------------------------------------

// Hyperdrive caches SQL responses by default, which breaks a transport built on
// re-reading a counter once a second: the symptom in a class is "everyone is
// stuck on the last question", with nothing in the logs to say why. Not being
// able to confirm the setting is therefore blocking, not a note.
if (!hyperdriveId) {
  add(
    "Hyperdrive caching",
    "unknown",
    "no usable Hyperdrive id in wrangler.jsonc, so caching could not be checked.\n" +
      "  Treated as blocking. Fix the Hyperdrive binding above first.",
  );
} else {
  const info = wrangler(["hyperdrive", "get", hyperdriveId]);
  if (info === null) {
    add(
      "Hyperdrive caching",
      "unknown",
      "wrangler could not be run, so the caching setting could not be read.\n" +
        "  Treated as blocking, because caching left on breaks realtime silently.\n" +
        `  Check manually with: npx wrangler hyperdrive get ${hyperdriveId}`,
    );
  } else {
    results.push(readHyperdriveCaching(info, hyperdriveId));
  }
}

// --- origin -----------------------------------------------------------------

results.push(checkAppOrigin(config, process.env));

// --- report -----------------------------------------------------------------

const symbol: Record<CheckStatus, string> = {
  ok: "  ok   ",
  warn: " warn  ",
  fail: " FAIL  ",
  unknown: " UNKNOWN",
};

console.log("\nCloudflare pre-deployment check\n");
for (const r of results) {
  console.log(`[${symbol[r.status]}] ${r.name}: ${r.detail}`);
}

const { blocking, exitCode } = summarise(results);
console.log("");
if (blocking.length > 0) {
  const unverified = blocking.filter((c) => c.status === "unknown").length;
  console.log(
    `${blocking.length} blocking problem(s)` +
      (unverified > 0 ? `, of which ${unverified} could not be verified` : "") +
      ". Deployment is not ready.",
  );
  console.log("An unverified check is not a passing check; nothing above was assumed.");
} else {
  console.log("All checks verified. No blocking problems found.");
}
process.exit(exitCode);
