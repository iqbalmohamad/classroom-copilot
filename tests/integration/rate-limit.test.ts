import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "./server";

/**
 * The limiter, in the real request path.
 *
 * Every other suite runs with CC_DISABLE_RATE_LIMIT set, because forty
 * simulated learners share one address. That makes it possible for the limiter
 * to be entirely unwired without a single test noticing, so this file runs its
 * own server with limits live.
 */
let server: RunningServer;

beforeAll(async () => {
  server = await startServer(Number(process.env.CC_RATELIMIT_PORT ?? 3317), {});
}, 120_000);

afterAll(async () => {
  await server?.stop();
});

async function post(path: string, body: unknown, ip: string) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  await response.text();
  return response.status;
}

describe("rate limiting, with the limiter switched on", () => {
  it("eventually refuses a flood of room creations from one address", async () => {
    const ip = "198.51.100.10";
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      statuses.push(await post("/api/rooms", {}, ip));
    }

    // Generous by design — a whole campus can share one address — but not
    // unlimited. If this never trips, the limiter is not wired into the route.
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(20);
  }, 60_000);

  it("does not let one address's flood affect anybody else", async () => {
    const flooder = "198.51.100.11";
    for (let i = 0; i < 40; i += 1) await post("/api/rooms", {}, flooder);
    expect(await post("/api/rooms", {}, flooder)).toBe(429);

    // A different classroom, on a different network, is unaffected.
    expect(await post("/api/rooms", {}, "203.0.113.77")).toBe(200);
  }, 60_000);

  it("cannot be evaded by forging the leftmost x-forwarded-for entry", async () => {
    const real = "198.51.100.12";
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const response = await fetch(`${server.baseUrl}/api/rooms`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A caller rotating a spoofed client address on every request.
          "x-forwarded-for": `10.0.0.${i}, ${real}`,
        },
        body: "{}",
        cache: "no-store",
      });
      await response.text();
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  }, 60_000);
});
