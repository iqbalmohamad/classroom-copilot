import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

/**
 * The privacy boundary, tested from the outside.
 *
 * Every one of these is a way a learner or a projector could plausibly reach
 * instructor-only capability or instructor-only data, and each must fail.
 */
describe("authorisation and privacy boundaries", () => {
  it("refuses every instructor action to a learner", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Clear?",
      kind: "yes_no",
      openNow: true,
    });
    const question = await learner.post(`/api/rooms/${code}/questions`, { body: "A question" });
    expect(question.status).toBe(200);
    const state = await snapshotFor<{ questions: { id: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    const questionId = state.body.snapshot.questions[0]!.id;

    const attempts: [string, Promise<{ status: number }>][] = [
      ["read the roster", learner.get(`/api/rooms/${code}/state?role=instructor`)],
      ["create a poll", learner.post(`/api/rooms/${code}/polls`, { prompt: "x", kind: "yes_no" })],
      [
        "close a poll",
        learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}`, { action: "close" }),
      ],
      [
        "reveal results",
        learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}`, { action: "reveal" }),
      ],
      ["pick a participant", learner.post(`/api/rooms/${code}/pick`)],
      ["change the shared screen", learner.post(`/api/rooms/${code}/public-mode`, { mode: "pick" })],
      [
        "mark a question answered",
        learner.post(`/api/rooms/${code}/questions/${questionId}`, { action: "answer" }),
      ],
      ["clear the class pulse", learner.delete(`/api/rooms/${code}/pulse`)],
      ["read the session summary", learner.get(`/api/rooms/${code}/summary`)],
      ["end the class", learner.post(`/api/rooms/${code}/end`)],
    ];

    for (const [label, promise] of attempts) {
      const result = await promise;
      expect(result.status, `learner must not be able to ${label}`).toBe(403);
    }
  });

  it("refuses instructor actions to an anonymous visitor who knows the code", async () => {
    const { code } = await createRoom();
    const stranger = new Client("stranger");

    expect((await stranger.post(`/api/rooms/${code}/pick`)).status).toBe(403);
    expect((await stranger.get(`/api/rooms/${code}/summary`)).status).toBe(403);
    expect((await stranger.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(403);
  });

  it("refuses learner actions to someone who has not joined", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/polls`, {
      prompt: "Clear?",
      kind: "yes_no",
      openNow: true,
    });
    const stranger = new Client("stranger");

    expect((await stranger.post(`/api/rooms/${code}/pulse`, { pulse: "lost" })).status).toBe(401);
    expect((await stranger.post(`/api/rooms/${code}/questions`, { body: "hello" })).status).toBe(
      401,
    );
    expect((await stranger.get(`/api/rooms/${code}/state?role=learner`)).status).toBe(401);
  });

  it("does not let a learner token from one room act in another", async () => {
    const roomA = await createRoom("Room A");
    const roomB = await createRoom("Room B");
    const { learner, token } = await joinAs(roomA.code, "Ada");

    learner.headerToken = { name: "x-cc-learner-token", value: token };
    const crossRoom = await learner.post(`/api/rooms/${roomB.code}/pulse`, { pulse: "lost" });
    expect(crossRoom.status).toBe(401);
  });

  it("does not let a host token from one room control another", async () => {
    const roomA = await createRoom("Room A");
    const roomB = await createRoom("Room B");

    const attacker = new Client("attacker");
    attacker.headerToken = { name: "x-cc-host-token", value: roomA.hostToken };
    expect((await attacker.post(`/api/rooms/${roomB.code}/end`)).status).toBe(403);
  });

  it("rejects a forged host token", async () => {
    const { code } = await createRoom();
    const attacker = new Client("attacker");
    attacker.headerToken = { name: "x-cc-host-token", value: "not-the-real-token" };
    expect((await attacker.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(403);
  });

  it("keeps every private field out of the public projection", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada Lovelace");
    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Clear?",
      kind: "yes_no",
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}/respond`, { value: "no" });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await learner.post(`/api/rooms/${code}/questions`, { body: "A private question" });

    const projector = new Client("projector");
    const result = await snapshotFor<Record<string, unknown>>(projector, code, "public");
    const snapshot = result.body.snapshot;
    const payload = JSON.stringify(result.body);

    expect(result.status).toBe(200);

    // Assert the exact shape rather than listing strings that must be absent:
    // a substring check can only guard against leaks someone thought of, and
    // passes trivially for any field name that was never used.
    expect(Object.keys(snapshot).sort()).toEqual([
      "activePoll",
      "joinUrl",
      "lastPick",
      "presentCount",
      "role",
      "room",
      "version",
    ]);
    expect(Object.keys(snapshot.room as object).sort()).toEqual([
      "code",
      "createdAt",
      "endedAt",
      "publicMode",
      "status",
      "title",
    ]);

    expect(payload).not.toContain("Ada Lovelace");
    expect(payload).not.toContain("A private question");
  });

  it("keeps the roster and other learners' data out of the learner projection", async () => {
    const { code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await joinAs(code, "Grace Hopper");

    const result = await snapshotFor(learner, code, "learner");
    const payload = JSON.stringify(result.body);

    expect(payload).toContain("Ada");
    expect(payload).not.toContain("Grace Hopper");
    expect(payload).not.toContain("roster");
    expect(payload).not.toContain("presentCount");
  });

  it("never returns a host token in any snapshot", async () => {
    const { instructor, code, hostToken } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const projector = new Client("projector");

    for (const [client, role] of [
      [instructor, "instructor"],
      [learner, "learner"],
      [projector, "public"],
    ] as const) {
      const result = await snapshotFor<{ role: string }>(client, code, role);
      // Without this, an error body would satisfy both negative checks below
      // and the test would pass while every surface was broken.
      expect(result.status).toBe(200);
      expect(result.body.snapshot.role).toBe(role);
      expect(JSON.stringify(result.body)).not.toContain(hostToken);
      expect(JSON.stringify(result.body)).not.toContain("host_token");
    }
  });

  it("restores instructor access from a valid host link and rejects a bad one", async () => {
    const { code, hostToken } = await createRoom();

    const newDevice = new Client("laptop");
    const claim = await newDevice.get(
      `/api/rooms/${code}/claim?t=${encodeURIComponent(hostToken)}`,
    );
    expect(claim.status).toBe(307);
    expect((await newDevice.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(200);

    const impostor = new Client("impostor");
    const bad = await impostor.get(`/api/rooms/${code}/claim?t=wrong`);
    expect(bad.status).toBe(307);
    expect((await impostor.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(403);
  });

  it("does not leak internal error detail on malformed input", async () => {
    const { instructor, code } = await createRoom();
    const result = await instructor.post(`/api/rooms/${code}/polls`, { prompt: 42 });
    expect(result.status).toBe(400);
    const payload = JSON.stringify(result.body);
    expect(payload).not.toContain("ZodError");
    expect(payload).not.toMatch(/\.ts:\d+/);          // no source locations
    expect(payload).not.toMatch(/\bat [A-Za-z_$]+ \(/); // no stack frames
    expect(payload).not.toContain("node_modules");
  });
});

describe("the shared screen shows only what the instructor has put on it", () => {
  it("does not carry a learner's name unless the projector is on the pick screen", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada Lovelace");
    await instructor.post(`/api/rooms/${code}/pick`);

    const projector = new Client("projector");

    // Picking switches the screen to the pick view, so the name is in scope.
    const onPick = await snapshotFor(projector, code, "public");
    expect(JSON.stringify(onPick.body)).toContain("Ada Lovelace");

    // Move the screen on, and the name must leave the payload — not merely stop
    // being rendered. /state?role=public needs no credential at all.
    await instructor.post(`/api/rooms/${code}/public-mode`, { mode: "join" });
    const afterwards = await snapshotFor(projector, code, "public");
    expect(JSON.stringify(afterwards.body)).not.toContain("Ada Lovelace");

    // ...and the same once the class is over.
    await instructor.post(`/api/rooms/${code}/public-mode`, { mode: "pick" });
    await instructor.post(`/api/rooms/${code}/end`);
    const ended = await snapshotFor(projector, code, "public");
    expect(JSON.stringify(ended.body)).not.toContain("Ada Lovelace");
  });

  it("never puts a database identifier on the shared screen", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");
    await instructor.post(`/api/rooms/${code}/pick`);

    const projector = new Client("projector");
    const payload = JSON.stringify((await snapshotFor(projector, code, "public")).body);
    // No UUIDs anywhere except the poll and option identifiers a learner needs.
    const uuids = payload.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
    expect(uuids).toBeNull();
  });
});
