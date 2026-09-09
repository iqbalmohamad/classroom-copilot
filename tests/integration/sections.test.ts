import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor, type Client } from "./client";

interface Rounds {
  pulseRound: {
    id: string;
    label: string | null;
    sectionTitle: string | null;
    summary: { counts: Record<string, number>; responded: number };
  } | null;
  pulseHistory: {
    id: string;
    sectionTitle: string | null;
    summary: { counts: Record<string, number>; responded: number };
  }[];
}

interface WithSections {
  room: { currentSectionId: string | null; currentSectionTitle: string | null };
  sections: { id: string; position: number; title: string }[];
}

const sectionsOf = async (client: Client, code: string, role = "instructor") =>
  (await snapshotFor<WithSections>(client, code, role)).body.snapshot;

describe("sections", () => {
  it("gives a brand-new room one section without anyone asking for it", async () => {
    const { instructor, code } = await createRoom();
    const state = await sectionsOf(instructor, code);

    // Quick-start: an instructor who never opens the planner still has
    // somewhere for polls, activities and pulse rounds to belong.
    expect(state.sections).toHaveLength(1);
    expect(state.sections[0]!.title).toBe("Section 1");
    expect(state.room.currentSectionId).toBe(state.sections[0]!.id);
  });

  it("creates the next section on Next when nothing was prepared", async () => {
    const { instructor, code } = await createRoom();

    const advanced = await instructor.post<{ title: string; created: boolean }>(
      `/api/rooms/${code}/sections/select`,
      {},
    );
    expect(advanced.status).toBe(200);
    expect(advanced.body.created).toBe(true);
    expect(advanced.body.title).toBe("Section 2");

    const state = await sectionsOf(instructor, code);
    expect(state.room.currentSectionTitle).toBe("Section 2");
  });

  it("prepares, renames, reorders and jumps straight to a section", async () => {
    const { instructor, code } = await createRoom();

    for (const title of ["Database Structure", "DDL/DML", "Environment Setup"]) {
      const created = await instructor.post(`/api/rooms/${code}/sections`, { title });
      expect(created.status).toBe(200);
    }

    let state = await sectionsOf(instructor, code);
    expect(state.sections.map((s) => s.title)).toEqual([
      "Section 1",
      "Database Structure",
      "DDL/DML",
      "Environment Setup",
    ]);

    const renamed = await instructor.patch(
      `/api/rooms/${code}/sections/${state.sections[0]!.id}`,
      { title: "Why SQL Exists" },
    );
    expect(renamed.status).toBe(200);

    const reversed = [...state.sections].reverse().map((s) => s.id);
    expect(
      (await instructor.post(`/api/rooms/${code}/sections/reorder`, { order: reversed })).status,
    ).toBe(200);

    state = await sectionsOf(instructor, code);
    expect(state.sections.map((s) => s.title)).toEqual([
      "Environment Setup",
      "DDL/DML",
      "Database Structure",
      "Why SQL Exists",
    ]);

    // Direct navigation, not just Next.
    const target = state.sections[2]!;
    expect(
      (await instructor.post(`/api/rooms/${code}/sections/select`, { sectionId: target.id })).status,
    ).toBe(200);
    expect((await sectionsOf(instructor, code)).room.currentSectionTitle).toBe(target.title);
  });

  it("refuses a reorder that is not a complete permutation", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/sections`, { title: "Second" });
    const state = await sectionsOf(instructor, code);

    const partial = await instructor.post(`/api/rooms/${code}/sections/reorder`, {
      order: [state.sections[0]!.id],
    });
    expect(partial.status).toBe(409);
    // Nothing half-applied.
    expect((await sectionsOf(instructor, code)).sections.map((s) => s.title)).toEqual([
      "Section 1",
      "Second",
    ]);
  });

  it("moving on never publishes a draft, and never erases what a section collected", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Kept as a draft",
      kind: "yes_no",
    });
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Prepared, not opened",
    });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });

    await instructor.post(`/api/rooms/${code}/sections/select`, {});

    const state = await snapshotFor<{
      polls: { id: string; status: string }[];
      activities: { id: string; status: string }[];
      pulseHistory: { summary: { responded: number; counts: Record<string, number> } }[];
    }>(instructor, code, "instructor");

    expect(state.body.snapshot.polls.find((p) => p.id === poll.body.pollId)!.status).toBe("draft");
    expect(state.body.snapshot.activities.find((a) => a.id === activity.body.id)!.status).toBe(
      "draft",
    );
    // Preserved, not still collecting: the answer is kept as history for the
    // section it was about.
    expect(state.body.snapshot.pulseHistory).toHaveLength(1);
    expect(state.body.snapshot.pulseHistory[0]!.summary.counts.lost).toBe(1);
  });

  it("stops collecting pulse into the section the class has left", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const first = (
      await snapshotFor<{ sections: { id: string }[] }>(instructor, code, "instructor")
    ).body.snapshot.sections[0]!;
    await instructor.patch(`/api/rooms/${code}/sections/${first.id}`, {
      title: "Why SQL Exists",
    });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });

    const before = await snapshotFor<Rounds>(instructor, code, "instructor");
    const staleRound = before.body.snapshot.pulseRound!;
    expect(staleRound.sectionTitle).toBe("Why SQL Exists");

    await instructor.post(`/api/rooms/${code}/sections/select`, {});

    // Nothing is collecting in the new section until someone asks or taps.
    const after = await snapshotFor<Rounds>(instructor, code, "instructor");
    expect(after.body.snapshot.pulseRound).toBeNull();
    expect(after.body.snapshot.pulseHistory[0]!.sectionTitle).toBe("Why SQL Exists");
    expect(after.body.snapshot.pulseHistory[0]!.summary.counts.lost).toBe(1);

    // A tap already in flight for the old round is refused rather than being
    // counted against a section the class is no longer in.
    const late = await learner.post(`/api/rooms/${code}/pulse`, {
      pulse: "got_it",
      roundId: staleRound.id,
    });
    expect(late.status).toBe(409);

    // The class tapping now opens a round in the section they are actually in.
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });
    const fresh = await snapshotFor<Rounds>(instructor, code, "instructor");
    expect(fresh.body.snapshot.pulseRound!.sectionTitle).toBe("Section 2");
    expect(fresh.body.snapshot.pulseRound!.summary.counts.got_it).toBe(1);
    // ...and the first section's reading is untouched by any of it.
    const original = fresh.body.snapshot.pulseHistory.find(
      (round) => round.sectionTitle === "Why SQL Exists",
    )!;
    expect(original.summary.counts).toMatchObject({ lost: 1, got_it: 0 });
  });

  it("keeps a round open when the section it is about is the one being entered", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await instructor.post(`/api/rooms/${code}/sections`, { title: "Database Structure" });
    const sections = (
      await snapshotFor<{ sections: { id: string }[] }>(instructor, code, "instructor")
    ).body.snapshot.sections;

    // Ask about the section we are about to walk into.
    await instructor.post(`/api/rooms/${code}/pulse/rounds`, { sectionId: sections[1]!.id });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" });

    await instructor.post(`/api/rooms/${code}/sections/select`, { sectionId: sections[1]!.id });

    const state = await snapshotFor<Rounds>(instructor, code, "instructor");
    expect(state.body.snapshot.pulseRound).not.toBeNull();
    expect(state.body.snapshot.pulseRound!.summary.counts.shaky).toBe(1);
  });

  it("lets the instructor revisit a section and ask it again, separately", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const sections0 = (
      await snapshotFor<{ sections: { id: string }[] }>(instructor, code, "instructor")
    ).body.snapshot.sections;
    await instructor.patch(`/api/rooms/${code}/sections/${sections0[0]!.id}`, { title: "DDL/DML" });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await instructor.post(`/api/rooms/${code}/sections/select`, {});

    // Come back, review, and ask again — a deliberate act, not a side effect.
    await instructor.post(`/api/rooms/${code}/sections/select`, { sectionId: sections0[0]!.id });
    expect(
      (await snapshotFor<Rounds>(instructor, code, "instructor")).body.snapshot.pulseRound,
    ).toBeNull();

    await instructor.post(`/api/rooms/${code}/pulse/rounds`, { label: "After re-explaining" });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    const state = await snapshotFor<Rounds>(instructor, code, "instructor");
    expect(state.body.snapshot.pulseRound!.sectionTitle).toBe("DDL/DML");
    expect(state.body.snapshot.pulseRound!.label).toBe("After re-explaining");
    const before = state.body.snapshot.pulseHistory.find((r) => r.sectionTitle === "DDL/DML")!;
    expect(before.summary.counts.lost).toBe(1);
  });

  it("keeps a pulse landing during a section change out of the wrong section", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      Array.from({ length: 6 }, (_, i) => joinAs(code, `P${i + 1}`)),
    );
    await learners[0]!.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });

    const opening = (await snapshotFor<Rounds>(instructor, code, "instructor")).body.snapshot
      .pulseRound!;

    // Everyone taps while the instructor is moving on. Each tap either lands in
    // the round it named or is refused; none is redirected into the new
    // section, and none is lost from the round it belonged to.
    const [advance, ...taps] = await Promise.all([
      instructor.post(`/api/rooms/${code}/sections/select`, {}),
      ...learners.slice(1).map((entry) =>
        entry.learner.post(`/api/rooms/${code}/pulse`, {
          pulse: "shaky",
          roundId: opening.id,
        }),
      ),
    ]);
    expect(advance!.status).toBe(200);
    expect(taps.every((tap) => tap!.status === 200 || tap!.status === 409)).toBe(true);

    const state = await snapshotFor<Rounds>(instructor, code, "instructor");
    const landed = taps.filter((tap) => tap!.status === 200).length;
    const original = state.body.snapshot.pulseHistory.find((round) => round.id === opening.id)!;
    expect(original.summary.counts.lost).toBe(1);
    expect(original.summary.counts.shaky).toBe(landed);
    // Whatever the interleaving, nothing about Section 1 was counted as Section 2.
    expect(state.body.snapshot.pulseRound).toBeNull();
  });

  it("learners see the current section without being able to change it", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await instructor.post(`/api/rooms/${code}/sections`, { title: "Why SQL Exists" });
    const state = await sectionsOf(instructor, code);
    await instructor.post(`/api/rooms/${code}/sections/select`, {
      sectionId: state.sections[1]!.id,
    });

    const learnerState = await sectionsOf(learner, code, "learner");
    expect(learnerState.room.currentSectionTitle).toBe("Why SQL Exists");

    expect((await learner.post(`/api/rooms/${code}/sections`, { title: "Mine" })).status).toBe(403);
    expect((await learner.post(`/api/rooms/${code}/sections/select`, {})).status).toBe(403);
  });
});
