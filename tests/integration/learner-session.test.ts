import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface InstructorSnapshot {
  roster: { displayName: string; present: boolean }[];
  joinedCount: number;
  presentCount: number;
}

async function roster(instructor: Client, code: string) {
  const result = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
  return result.body.snapshot;
}

describe("learner sessions", () => {
  it("puts a learner on the roster as soon as they join", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada Lovelace");

    const state = await roster(instructor, code);
    expect(state.joinedCount).toBe(1);
    expect(state.presentCount).toBe(1);
    expect(state.roster[0]?.displayName).toBe("Ada Lovelace");
  });

  it("reuses the same identity when a learner refreshes and re-joins", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    // A refresh re-posts the join with the cookie the browser still holds.
    const again = await learner.post<{ rejoined: boolean; displayName: string }>(
      `/api/rooms/${code}/join`,
      { displayName: "Ada" },
    );
    expect(again.body.rejoined).toBe(true);

    const state = await roster(instructor, code);
    expect(state.joinedCount).toBe(1);
  });

  it("does not create a duplicate when the same tab joins twice in a row", async () => {
    const { instructor, code } = await createRoom();
    const learner = new Client("Ada");
    await learner.post(`/api/rooms/${code}/join`, { displayName: "Ada" });
    await learner.post(`/api/rooms/${code}/join`, { displayName: "Ada" });
    await learner.post(`/api/rooms/${code}/join`, { displayName: "Ada" });

    expect((await roster(instructor, code)).joinedCount).toBe(1);
  });

  it("keeps two different learners with the same name apart", async () => {
    const { instructor, code } = await createRoom();
    const first = await joinAs(code, "Sam");
    const second = await joinAs(code, "Sam");

    expect(first.displayName).toBe("Sam");
    expect(second.displayName).toBe("Sam (2)");
    expect((await roster(instructor, code)).joinedCount).toBe(2);
  });

  it("keeps distinct identities when many learners join at the same moment", async () => {
    const { instructor, code } = await createRoom();
    const names = Array.from({ length: 12 }, (_, i) => `Learner ${i + 1}`);
    await Promise.all(names.map((name) => joinAs(code, name)));

    const state = await roster(instructor, code);
    expect(state.joinedCount).toBe(12);
    expect(new Set(state.roster.map((r) => r.displayName)).size).toBe(12);
  });

  it("recovers a learner whose browser lost its cookies, using the token copy", async () => {
    const { instructor, code } = await createRoom();
    const { learner, token } = await joinAs(code, "Ada");

    learner.clearCookies();
    // Denied without any credential at all.
    const denied = await learner.get(`/api/rooms/${code}/state?role=learner`);
    expect(denied.status).toBe(401);

    // The client's localStorage copy travels as a header instead.
    learner.headerToken = { name: "x-cc-learner-token", value: token };
    const recovered = await learner.get(`/api/rooms/${code}/state?role=learner`);
    expect(recovered.status).toBe(200);

    // Still one learner on the roster: recovery is not a second join.
    expect((await roster(instructor, code)).joinedCount).toBe(1);
  });

  it("rejects an empty or whitespace-only name", async () => {
    const { code } = await createRoom();
    const learner = new Client("blank");
    const result = await learner.post(`/api/rooms/${code}/join`, { displayName: "   " });
    expect(result.status).toBe(400);
  });
});
