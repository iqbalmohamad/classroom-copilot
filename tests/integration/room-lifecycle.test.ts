import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

describe("room lifecycle", () => {
  it("creates a room with a readable code and a private host token", async () => {
    const { instructor, code, hostToken } = await createRoom("Week 3 — Promises");

    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(hostToken.length).toBeGreaterThan(20);

    const snapshot = await snapshotFor(instructor, code, "instructor");
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.snapshot.room.title).toBe("Week 3 — Promises");
    expect(snapshot.body.snapshot.room.status).toBe("open");
  });

  it("gives a clear error for a code that does not exist", async () => {
    const stranger = new Client("stranger");
    const result = await stranger.get("/api/rooms/ZZZZZZ/state?role=public");
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).toContain("not found");
  });

  it("rejects an unknown view name rather than guessing", async () => {
    const { code } = await createRoom();
    const stranger = new Client("stranger");
    const result = await stranger.get(`/api/rooms/${code}/state?role=admin`);
    expect(result.status).toBe(400);
  });

  it("accepts a lower-case or spaced code the way a learner would type it", async () => {
    const { code } = await createRoom();
    const stranger = new Client("stranger");
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`.toLowerCase();
    const result = await stranger.get(`/api/rooms/${encodeURIComponent(spaced)}/state?role=public`);
    expect(result.status).toBe(200);
  });

  it("closes the room to new joins and to responses once ended", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");

    const ended = await instructor.post(`/api/rooms/${code}/end`);
    expect(ended.status).toBe(200);

    const latecomer = new Client("late");
    const join = await latecomer.post(`/api/rooms/${code}/join`, { displayName: "Late" });
    expect(join.status).toBe(410);

    // The instructor keeps access to the record of the session.
    const summary = await instructor.get(`/api/rooms/${code}/summary`);
    expect(summary.status).toBe(200);
  });

  it("keeps the instructor signed in on a browser that only has the cookie", async () => {
    const { instructor, code } = await createRoom();

    // Model a reload properly: a brand new client that has nothing but the
    // cookie the create response set. Two identical requests from the same jar
    // would prove nothing about the cookie at all.
    const cookie = instructor.cookieHeader();
    expect(cookie).toContain(`cc_host_${code}`);

    const reloaded = new Client("reloaded tab");
    const result = await reloaded.request<{ snapshot: { role: string } }>(
      `/api/rooms/${code}/state?role=instructor`,
      { headers: { cookie } },
    );
    expect(result.status).toBe(200);
    expect(result.body.snapshot.role).toBe("instructor");

    // ...and a browser without it is refused.
    const stranger = new Client("stranger");
    expect((await stranger.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(403);
  });

  it("sets the instructor cookie httpOnly and same-site", async () => {
    const client = new Client("instructor");
    const created = await client.request<{ code: string }>("/api/rooms", {
      method: "POST",
      body: {},
    });
    expect(created.status).toBe(200);

    const cookie = client.setCookies.find((raw) => raw.startsWith("cc_host_"));
    expect(cookie).toBeDefined();
    expect(cookie!.toLowerCase()).toContain("httponly");
    expect(cookie!.toLowerCase()).toContain("samesite=lax");
    expect(cookie!.toLowerCase()).toContain("path=/");
  });
});
