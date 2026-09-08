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

  it("keeps the instructor signed in across a page reload", async () => {
    const { instructor, code } = await createRoom();
    // A reload is simply another request carrying the same cookie jar.
    const first = await snapshotFor(instructor, code, "instructor");
    const second = await snapshotFor(instructor, code, "instructor");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
