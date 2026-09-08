import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor } from "./client";

interface WithPicks {
  picks: { id: string; displayName: string }[];
  room: { publicMode: string };
}

describe("participant picker", () => {
  it("says so plainly when there is nobody to pick", async () => {
    const { instructor, code } = await createRoom();
    const result = await instructor.post(`/api/rooms/${code}/pick`);
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain("No learners");
  });

  it("picks a learner who is actually in the room", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");

    const result = await instructor.post<{ displayName: string }>(`/api/rooms/${code}/pick`);
    expect(result.status).toBe(200);
    expect(result.body.displayName).toBe("Ada");
  });

  it("gives everyone a turn before anyone gets a second one", async () => {
    const { instructor, code } = await createRoom();
    const names = ["Ada", "Grace", "Alan", "Katherine", "Edsger"];
    for (const name of names) await joinAs(code, name);

    const picked: string[] = [];
    for (let i = 0; i < names.length; i += 1) {
      const result = await instructor.post<{ displayName: string }>(`/api/rooms/${code}/pick`);
      picked.push(result.body.displayName);
    }

    expect(new Set(picked).size).toBe(names.length);
    expect([...picked].sort()).toEqual([...names].sort());
  });

  it("never picks the same learner twice in a row once the pool recycles", async () => {
    const { instructor, code } = await createRoom();
    for (const name of ["Ada", "Grace", "Alan"]) await joinAs(code, name);

    const picked: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const result = await instructor.post<{ displayName: string }>(`/api/rooms/${code}/pick`);
      picked.push(result.body.displayName);
    }

    for (let i = 1; i < picked.length; i += 1) {
      expect(picked[i]).not.toBe(picked[i - 1]);
    }
  });

  it("keeps picking the only learner in a one-person room", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Solo");

    for (let i = 0; i < 3; i += 1) {
      const result = await instructor.post<{ displayName: string }>(`/api/rooms/${code}/pick`);
      expect(result.body.displayName).toBe("Solo");
    }
  });

  it("keeps the selection history and puts the pick on the shared screen", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");
    await joinAs(code, "Grace");

    await instructor.post(`/api/rooms/${code}/pick`);
    await instructor.post(`/api/rooms/${code}/pick`);

    const state = await snapshotFor<WithPicks>(instructor, code, "instructor");
    expect(state.body.snapshot.picks).toHaveLength(2);
    expect(state.body.snapshot.room.publicMode).toBe("pick");
  });
});
