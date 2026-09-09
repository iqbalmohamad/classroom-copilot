/**
 * Pre-deployment check for Cloudflare Workers.
 *
 * Catches the handful of mistakes that would otherwise be discovered by a class
 * of forty learners: a placeholder Hyperdrive id, a missing public origin, a
 * secret committed by accident, or a build that was never produced.
 *
 *   npm run cf:check
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

const results: Check[] = [];
const add = (name: string, status: Check["status"], detail: string) =>
  results.push({ name, status, detail });

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// --- wrangler configuration -------------------------------------------------

let wrangler = "";
try {
  wrangler = read("wrangler.jsonc");
  add("wrangler.jsonc", "ok", "present");
} catch {
  add("wrangler.jsonc", "fail", "missing");
}

if (wrangler) {
  if (wrangler.includes("REPLACE_WITH_HYPERDRIVE_ID")) {
    add(
      "Hyperdrive binding",
      "fail",
      'still the placeholder id. Create one with:\n    npx wrangler hyperdrive create classroom-copilot-db \\\n      --connection-string="postgresql://USER:PASSWORD@HOST:5432/postgres" \\\n      --caching-disabled\n  then paste the returned id into wrangler.jsonc.',
    );
  } else if (/"hyperdrive"\s*:/.test(wrangler)) {
    add("Hyperdrive binding", "ok", "configured");
  } else {
    add(
      "Hyperdrive binding",
      "fail",
      "absent. postgres.js cannot negotiate TLS on workerd, so a Worker cannot reach a hosted database without it.",
    );
  }

  if (/"compatibility_flags"[\s\S]{0,80}nodejs_compat/.test(wrangler)) {
    add("nodejs_compat flag", "ok", "set");
  } else {
    add("nodejs_compat flag", "fail", "required by the adapter and by postgres.js");
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

try {
  const who = execFileSync("npx", ["wrangler", "whoami"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).toString();
  if (/not authenticated/i.test(who)) {
    add("Cloudflare login", "fail", "not authenticated — run `npx wrangler login`");
  } else {
    const account = /│\s*(.+?)\s*│\s*([0-9a-f]{32})\s*│/.exec(who);
    add("Cloudflare login", "ok", account ? `account ${account[1]}` : "authenticated");
  }
} catch {
  add("Cloudflare login", "warn", "could not determine (no network, or wrangler unavailable)");
}

// --- Hyperdrive caching -----------------------------------------------------

// Hyperdrive caches SQL responses by default, which breaks a transport built on
// re-reading a counter. Only checkable when authenticated, but worth checking:
// the symptom in a class is "everyone is stuck on the last question".
const hyperdriveId = /"id"\s*:\s*"([0-9a-f]{16,})"/.exec(wrangler)?.[1];
if (hyperdriveId) {
  try {
    const info = execFileSync("npx", ["wrangler", "hyperdrive", "get", hyperdriveId], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }).toString();
    if (/"disabled"\s*:\s*true/.test(info) || /caching[^\n]*disabled/i.test(info)) {
      add("Hyperdrive caching", "ok", "disabled, as this app requires");
    } else {
      add(
        "Hyperdrive caching",
        "fail",
        `appears to be enabled. Realtime updates will go stale.\n  Fix: npx wrangler hyperdrive update ${hyperdriveId} --caching-disabled`,
      );
    }
  } catch {
    add("Hyperdrive caching", "warn", "could not check (not authenticated, or no network)");
  }
}

// --- origin -----------------------------------------------------------------

const origin = process.env.APP_ORIGIN?.trim();
if (origin) {
  add("APP_ORIGIN", "ok", origin);
} else {
  add(
    "APP_ORIGIN",
    "warn",
    "not set in this shell. It must be set on the deployed Worker, or join URLs and the QR code are built from request headers.\n  Add it to the `vars` block in wrangler.jsonc once the hostname is known.",
  );
}

// --- report -----------------------------------------------------------------

const symbol = { ok: "  ok  ", warn: " warn ", fail: " FAIL " } as const;
console.log("\nCloudflare pre-deployment check\n");
for (const r of results) {
  console.log(`[${symbol[r.status]}] ${r.name}: ${r.detail}`);
}

const failures = results.filter((r) => r.status === "fail");
console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} blocking problem(s). Deployment would not work yet.`);
  process.exit(1);
}
console.log("No blocking problems found.");
