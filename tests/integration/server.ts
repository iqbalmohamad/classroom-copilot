import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";

/**
 * Spawns an extra application server for a suite that needs different
 * configuration from the shared one — currently, one with rate limiting left
 * switched on.
 */
export interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function startServer(
  port: number,
  env: Record<string, string>,
): Promise<RunningServer> {
  if (await listening(port)) {
    throw new Error(`Port ${port} is already in use; refusing to test against it.`);
  }

  const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child: ChildProcess = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.CC_TEST_DATABASE_URL ?? process.env.DATABASE_URL!,
      NODE_ENV: "production",
      CC_ALLOW_INSECURE_COOKIES: "1",
      AI_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const logs: string[] = [];
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited (${child.exitCode})\n${logs.join("")}`);
    }
    if (await listening(port)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const stop = async () => {
    if (child.exitCode !== null || child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    for (let i = 0; i < 40 && child.exitCode === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  return { baseUrl, stop };
}
