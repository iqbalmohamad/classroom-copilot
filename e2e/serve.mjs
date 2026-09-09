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
 */
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

const port = process.env.CC_E2E_PORT ?? "3312";

if (process.env.CC_SKIP_BUILD !== "1") {
  execFileSync("npm", ["run", "build"], { stdio: "inherit" });
}

const next = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, "start", "-p", port], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
