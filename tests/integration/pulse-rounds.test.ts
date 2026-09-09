import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor, type Client } from "./client";

interface RoundSnapshot {
  pulseRound: {
    id: string;
    label: string | null;
    sectionTitle: string | null;
    summary: { counts: Record<string, number>; responded: number; total: number };
  } | null;
  pulseHistory: {
    seq: number;
    label: string | null;
    sectionTitle: string | null;
    summary: { counts: Record<string, number>; responded: number };
  }[];
}

const rounds = async (instructor: Client, code: string) =>
  (await snapshotFor<RoundSnapshot>(instructor, code, "instructor")).body.snapshot;

describe("pulse rounds", () => {
  it("keeps the previous round instead of erasing it", async () => {
    const { instructor, code } = await createRoom();
    const a = await joinAs(code, "Ada");
    const b = await joinAs(code, "Grace");

    await a.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await b.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    expect((await rounds(instructor, code)).pulseRound!.summary.counts.lost).toBe(2);

    // Re-explain, then ask again. This is the whole point: the "before" must
    // still be there to compare against.
    await instructor.post(`/api/rooms/${code}/pulse/rounds`, { label: "After the explanation" });

    let state = await rounds(instructor, code);
    expect(state.pulseRound!.label).toBe("After the explanation");
    expect(state.pulseRound!.summary.responded).toBe(0);
    expect(state.pulseHistory).toHaveLength(1);
    expect(state.pulseHistory[0]!.summary.counts.lost).toBe(2);

    await a.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });
    await b.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    state = await rounds(instructor, code);
    expect(state.pulseRound!.summary.counts.got_it).toBe(2);
    expect(state.pulseHistory[0]!.summary.counts.lost).toBe(2);
  });

  it("still supports the quick next-topic button, without losing anything", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" });

    const cleared = await instructor.delete(`/api/rooms/${code}/pulse`);
    expect(cleared.status).toBe(200);

    const state = await rounds(instructor, code);
    expect(state.pulseRound!.summary.responded).toBe(0);
    expect(state.pulseHistory[0]!.summary.counts.shaky).toBe(1);
  });

  it("lets a learner change their mind inside a round", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    const state = await rounds(instructor, code);
    expect(state.pulseRound!.summary.responded).toBe(1);
    expect(state.pulseRound!.summary.counts).toEqual({ got_it: 1, shaky: 0, lost: 0 });
  });

  it("rejects a tap aimed at a round that has already closed", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });

    const stale = (await rounds(instructor, code)).pulseRound!.id;
    await instructor.post(`/api/rooms/${code}/pulse/rounds`, {});

    // A tap that was in flight when the instructor moved on must not be counted
    // against a question the class has not been asked yet.
    const late = await learner.post(`/api/rooms/${code}/pulse`, {
      pulse: "got_it",
      roundId: stale,
    });
    expect(late.status).toBe(409);
    expect((await rounds(instructor, code)).pulseRound!.summary.responded).toBe(0);
  });

  it("attributes a round to the section it was asked in, and can revisit one", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await instructor.patch(
      `/api/rooms/${code}/sections/${
        (await snapshotFor<{ sections: { id: string }[] }>(instructor, code, "instructor")).body
          .snapshot.sections[0]!.id
      }`,
      { title: "Why SQL Exists" },
    );
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" });

    await instructor.post(`/api/rooms/${code}/sections/select`, {});
    await instructor.post(`/api/rooms/${code}/pulse/rounds`, {});
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    const sections = (
      await snapshotFor<{ sections: { id: string; title: string }[] }>(
        instructor,
        code,
        "instructor",
      )
    ).body.snapshot.sections;

    // Go back and ask the first section again.
    await instructor.post(`/api/rooms/${code}/pulse/rounds`, {
      sectionId: sections[0]!.id,
      label: "Revisit",
    });

    const state = await rounds(instructor, code);
    expect(state.pulseRound!.sectionTitle).toBe("Why SQL Exists");
    expect(state.pulseHistory.map((r) => r.sectionTitle)).toEqual(["Section 2", "Why SQL Exists"]);
  });

  it("never exposes who chose what, to anyone but the learner themselves", async () => {
    const { Client } = await import("./client");
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");
    const grace = await joinAs(code, "Grace");

    await ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await grace.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    // The instructor sees the aggregate and the roster, and no roster row
    // carries a pulse — watching one name's value change is the leak this
    // separation exists to prevent.
    const host = await snapshotFor<{
      roster: Record<string, unknown>[];
      pulseRound: { summary: { responded: number } };
    }>(instructor, code, "instructor");
    expect(host.body.snapshot.pulseRound.summary.responded).toBe(2);
    for (const entry of host.body.snapshot.roster) {
      expect(Object.keys(entry)).not.toContain("pulse");
    }

    // A learner sees their own pulse, and nothing at all about anyone else.
    const mine = await snapshotFor<{ me: { displayName: string; pulse: string } }>(
      ada.learner,
      code,
      "learner",
    );
    expect(mine.body.snapshot.me.pulse).toBe("lost");
    expect(JSON.stringify(mine.body.snapshot)).not.toContain("Grace");

    // The projector gets no names and no pulse at all.
    const screen = await snapshotFor(new Client("screen"), code, "public");
    const text = JSON.stringify(screen.body.snapshot);
    expect(text).not.toContain("Ada");
    expect(text).not.toContain("Grace");
    expect(text).not.toContain("got_it");
  });
});
