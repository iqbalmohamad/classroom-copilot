import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor, type Client } from "./client";

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

  it("moving on never publishes a draft or erases what a section collected", async () => {
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
      pulseRound: { summary: { responded: number } } | null;
    }>(instructor, code, "instructor");

    expect(state.body.snapshot.polls.find((p) => p.id === poll.body.pollId)!.status).toBe("draft");
    expect(state.body.snapshot.activities.find((a) => a.id === activity.body.id)!.status).toBe(
      "draft",
    );
    // The round the class answered is still collecting and still counted.
    expect(state.body.snapshot.pulseRound?.summary.responded).toBe(1);
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
