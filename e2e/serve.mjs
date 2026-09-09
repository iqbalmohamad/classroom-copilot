/**
 * Builds, then serves, the app the browser suite tests.
 *
 * The build has to happen here rather than in globalSetup: Playwright starts
 * the web server *before* globalSetup runs, so a build placed there lands one
 * run too late and every suite silently tests the previous revision. That is
 * the exact false green the harness exists to prevent, so the build is now part
 * of starting the server.
 *
 * CC_SKIP_BUILD=1 reuses whatever is in .next, for tight local iteration.
 *
 * Both commands run Next's own entry point with the current Node binary rather
 * than going through npm: `execFileSync("npm", …)` fails with ENOENT on
 * Windows, where npm is npm.cmd and execFile will not resolve it without a
 * shell. This way is identical on every platform.
 */
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

const port = process.env.CC_E2E_PORT ?? "3312";
const next = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

if (process.env.CC_SKIP_BUILD !== "1") {
  execFileSync(process.execPath, [next, "build"], { stdio: "inherit" });
}

const child = spawn(process.execPath, [next, "start", "-p", port], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
