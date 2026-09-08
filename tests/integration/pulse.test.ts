import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor, type Client } from "./client";

interface PulseSnapshot {
  pulse: {
    counts: { got_it: number; shaky: number; lost: number };
    percents: { got_it: number; shaky: number; lost: number };
    responded: number;
    noResponse: number;
    total: number;
  };
}

async function pulse(instructor: Client, code: string) {
  const state = await snapshotFor<PulseSnapshot>(instructor, code, "instructor");
  return state.body.snapshot.pulse;
}

describe("class pulse", () => {
  it("replaces a learner's previous state instead of adding to it", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    expect((await pulse(instructor, code)).counts).toEqual({ got_it: 0, shaky: 0, lost: 1 });

    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" });
    const after = await pulse(instructor, code);
    expect(after.counts).toEqual({ got_it: 0, shaky: 1, lost: 0 });
    expect(after.responded).toBe(1);
  });

  it("never counts one learner's repeated taps as several learners", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    for (let i = 0; i < 8; i += 1) {
      await learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });
    }
    const state = await pulse(instructor, code);
    expect(state.counts.got_it).toBe(1);
    expect(state.responded).toBe(1);
  });

  it("survives a flurry of concurrent taps from the same learner", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await Promise.all(
      ["got_it", "shaky", "lost", "got_it", "shaky"].map((value) =>
        learner.post(`/api/rooms/${code}/pulse`, { pulse: value }),
      ),
    );
    const state = await pulse(instructor, code);
    expect(state.responded).toBe(1);
    expect(state.counts.got_it + state.counts.shaky + state.counts.lost).toBe(1);
  });

  it("aggregates the class and reports who has not answered", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      Array.from({ length: 4 }, (_, i) => joinAs(code, `P${i + 1}`)),
    );

    await learners[0]!.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });
    await learners[1]!.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });
    await learners[2]!.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });

    const state = await pulse(instructor, code);
    expect(state.counts).toEqual({ got_it: 2, shaky: 0, lost: 1 });
    expect(state.percents.got_it).toBe(67);
    expect(state.responded).toBe(3);
    expect(state.noResponse).toBe(1);
    expect(state.total).toBe(4);
  });

  it("lets the instructor clear the pulse before a new topic", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });

    const cleared = await instructor.delete(`/api/rooms/${code}/pulse`);
    expect(cleared.status).toBe(200);
    expect((await pulse(instructor, code)).responded).toBe(0);
  });

  it("rejects a pulse value that is not one of the three states", async () => {
    const { code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const result = await learner.post(`/api/rooms/${code}/pulse`, { pulse: "confused" });
    expect(result.status).toBe(400);
  });
});
