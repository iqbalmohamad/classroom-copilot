/**
 * Starts the development server.
 *
 * This exists only to set one environment variable portably. `VAR=1 next dev`
 * in an npm script is a Unix shell construct: on Windows, npm runs scripts
 * through cmd.exe, which reads `CC_ALLOW_INSECURE_COOKIES=1` as the name of a
 * program and fails. Setting it here works the same way on every platform.
 *
 * The variable drops the Secure flag from session cookies so that a local
 * http://localhost run can hold a session at all. It is deliberately not in
 * .env.example's active section: it must never reach a deployment.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const next = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, "dev", "-p", "3000"], {
  stdio: "inherit",
  env: { ...process.env, CC_ALLOW_INSECURE_COOKIES: "1" },
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
