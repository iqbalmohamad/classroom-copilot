import { describe, expect, it } from "vitest";
import { BASE_URL, createRoom, joinAs, snapshotFor, Client } from "./client";

/**
 * The realtime transport, exercised over real HTTP.
 *
 * These tests read the server-sent event stream the way a browser does and
 * assert that a change made by one client reaches another without anyone
 * refreshing. They complement — they do not replace — the multi-browser
 * checks in e2e/.
 */
interface StreamReader {
  events: { type: string; data: string }[];
  waitFor: (predicate: (event: { type: string; data: string }) => boolean, ms?: number) => Promise<
    { type: string; data: string }
  >;
  close: () => void;
}

async function openStream(path: string, cookie?: string): Promise<StreamReader> {
  const controller = new AbortController();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { cookie } : {},
    signal: controller.signal,
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`);
  }

  const events: { type: string; data: string }[] = [];
  const listeners: (() => void)[] = [];

  (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const type = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (type && data !== undefined) {
            events.push({ type, data });
            listeners.splice(0).forEach((notify) => notify());
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();

  return {
    events,
    close: () => controller.abort(),
    waitFor(predicate, ms = 4_000) {
      const deadline = Date.now() + ms;
      return new Promise((resolve, reject) => {
        const check = () => {
          const match = events.find(predicate);
          if (match) return resolve(match);
          if (Date.now() > deadline) return reject(new Error("timed out waiting for event"));
          listeners.push(check);
          setTimeout(check, 150);
        };
        check();
      });
    },
  };
}

describe("realtime stream", () => {
  it("pushes the initial state immediately on connect", async () => {
    const { code } = await createRoom();
    const stream = await openStream(`/api/rooms/${code}/stream?role=public`);
    try {
      const first = await stream.waitFor((event) => event.type === "state");
      const snapshot = JSON.parse(first.data);
      expect(snapshot.role).toBe("public");
      expect(snapshot.room.code).toBe(code);
    } finally {
      stream.close();
    }
  });

  it("pushes an update to the shared screen when a learner joins, promptly", async () => {
    const { code } = await createRoom();
    const stream = await openStream(`/api/rooms/${code}/stream?role=public`);
    try {
      await stream.waitFor((event) => event.type === "state");
      const startedAt = Date.now();
      await joinAs(code, "Ada");

      const update = await stream.waitFor((event) => {
        if (event.type !== "state") return false;
        return JSON.parse(event.data).presentCount === 1;
      });
      const latency = Date.now() - startedAt;

      expect(JSON.parse(update.data).presentCount).toBe(1);
      // The loop also re-emits every 10s regardless of change, so an assertion
      // that only waits for eventual arrival would pass even if push-on-change
      // were completely broken. Pin the latency instead.
      expect(latency).toBeLessThan(2_000);
    } finally {
      stream.close();
    }
  });

  it("pushes the instructor's own view: a join reaches the console live", async () => {
    const { instructor, code } = await createRoom();
    const stream = await openStream(
      `/api/rooms/${code}/stream?role=instructor`,
      instructor.cookieHeader(),
    );
    try {
      const first = await stream.waitFor((event) => event.type === "state");
      expect(JSON.parse(first.data).role).toBe("instructor");

      const startedAt = Date.now();
      await joinAs(code, "Ada");
      const update = await stream.waitFor((event) => {
        if (event.type !== "state") return false;
        const snapshot = JSON.parse(event.data);
        return snapshot.roster?.some((r: { displayName: string }) => r.displayName === "Ada");
      });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(JSON.parse(update.data).roster).toHaveLength(1);
    } finally {
      stream.close();
    }
  });

  it("pushes a learner's own view, and never another learner's data", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await joinAs(code, "Grace Hopper");

    const stream = await openStream(
      `/api/rooms/${code}/stream?role=learner`,
      learner.cookieHeader(),
    );
    try {
      const first = await stream.waitFor((event) => event.type === "state");
      const snapshot = JSON.parse(first.data);
      expect(snapshot.role).toBe("learner");
      expect(snapshot.me.displayName).toBe("Ada");
      expect(first.data).not.toContain("Grace Hopper");
      expect(first.data).not.toContain("roster");

      const startedAt = Date.now();
      await instructor.post(`/api/rooms/${code}/polls`, {
        prompt: "Reaching the phone?",
        kind: "yes_no",
        openNow: true,
      });
      await stream.waitFor((event) => {
        if (event.type !== "state") return false;
        return JSON.parse(event.data).activePoll?.prompt === "Reaching the phone?";
      });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
    } finally {
      stream.close();
    }
  });

  it("pushes a poll opening to the shared screen without a refresh", async () => {
    const { instructor, code } = await createRoom();
    const stream = await openStream(`/api/rooms/${code}/stream?role=public`);
    try {
      await stream.waitFor((event) => event.type === "state");

      const startedAt = Date.now();
      await instructor.post(`/api/rooms/${code}/polls`, {
        prompt: "Is this landing live?",
        kind: "yes_no",
        openNow: true,
      });

      const update = await stream.waitFor((event) => {
        if (event.type !== "state") return false;
        return JSON.parse(event.data).activePoll?.prompt === "Is this landing live?";
      });
      const snapshot = JSON.parse(update.data);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(snapshot.room.publicMode).toBe("poll");
      expect(snapshot.activePoll.tallies).toBeNull();
    } finally {
      stream.close();
    }
  });

  it("refuses a stream for a view the caller is not entitled to", async () => {
    const { code } = await createRoom();
    const response = await fetch(`${BASE_URL}/api/rooms/${code}/stream?role=instructor`, {
      cache: "no-store",
    });
    expect(response.status).toBe(403);
    await response.body?.cancel();
  });

  it("advances the room version on every meaningful change", async () => {
    const { instructor, code } = await createRoom();
    const before = await snapshotFor<{ version: number }>(instructor, code, "instructor");
    await joinAs(code, "Ada");
    const after = await snapshotFor<{ version: number }>(instructor, code, "instructor");
    expect(after.body.snapshot.version).toBeGreaterThan(before.body.snapshot.version);
  });

  it("does not advance the version for presence heartbeats alone", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const before = await snapshotFor<{ version: number }>(instructor, code, "instructor");
    // A learner reading state is a heartbeat; several of them must not churn
    // the version, or every client in the room would re-render constantly.
    for (let i = 0; i < 4; i += 1) {
      await learner.get(`/api/rooms/${code}/state?role=learner`);
    }
    const after = await snapshotFor<{ version: number }>(instructor, code, "instructor");
    expect(after.body.snapshot.version).toBe(before.body.snapshot.version);
  });
});
