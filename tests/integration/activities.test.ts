import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface HostActivities {
  activities: {
    id: string;
    title: string;
    status: string;
    attempt: number;
    responseCount: number;
    referenceAnswer?: string | null;
    reviewCounts?: Record<string, number>;
    fields: { key: string; label: string; type: string }[];
  }[];
}

interface LearnerActivities {
  activities: { id: string; title: string; fields: { key: string; type: string }[] }[];
  mySubmissions: { activityId: string; answers: Record<string, string>; feedback: string | null }[];
}

/** The Day 30 exercise: pick the table, then say why. */
const QUANTITY_EXERCISE = {
  title: "Where does the quantity ordered belong?",
  instructions: "A customer buys 3 units of one product inside a single order.",
  fields: [
    { label: "Table", type: "choice", choices: ["products", "orders", "order_items"] },
    { label: "Why, in one sentence", type: "long_text" },
  ],
  referenceAnswer: "order_items — quantity belongs to one product inside one order.",
};

describe("activities", () => {
  it("collects a choice plus a written explanation from several learners at once", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      ["Ada", "Grace", "Alan"].map((name) => joinAs(code, name)),
    );

    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      ...QUANTITY_EXERCISE,
      openNow: true,
    });
    expect(created.status).toBe(200);
    const activityId = created.body.id;

    const seen = await snapshotFor<LearnerActivities>(learners[0]!.learner, code, "learner");
    const fields = seen.body.snapshot.activities[0]!.fields;
    expect(fields.map((f) => f.type)).toEqual(["choice", "long_text"]);

    const results = await Promise.all(
      learners.map((entry, i) =>
        entry.learner.post(`/api/rooms/${code}/activities/${activityId}/respond`, {
          answers: { f1: i === 2 ? "c2" : "c3", f2: `Because of reason ${i}` },
        }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const host = await snapshotFor<HostActivities>(instructor, code, "instructor");
    expect(host.body.snapshot.activities[0]!.responseCount).toBe(3);
    expect(host.body.snapshot.activities[0]!.reviewCounts!.pending).toBe(3);
  });

  it("accepts a number, multiline SQL and several fields, and keeps the formatting", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Prove your connection is alive",
      fields: [
        { label: "Row count", type: "number" },
        { label: "The SQL you ran", type: "sql" },
      ],
      openNow: true,
    });

    const sqlText = "SELECT version();\n  -- indented on purpose\nSELECT 1;";
    const posted = await learner.post(
      `/api/rooms/${code}/activities/${created.body.id}/respond`,
      { answers: { f1: "42", f2: sqlText } },
    );
    expect(posted.status).toBe(200);

    const mine = await snapshotFor<LearnerActivities>(learner, code, "learner");
    expect(mine.body.snapshot.mySubmissions[0]!.answers.f2).toBe(sqlText);

    // A number field only takes a number.
    const bad = await learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
      answers: { f1: "forty two", f2: sqlText },
    });
    expect(bad.status).toBe(400);
  });

  it("replaces a learner's own answer rather than adding a second one", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "One answer",
      openNow: true,
    });

    await learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
      answers: { f1: "first" },
    });
    await learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
      answers: { f1: "second" },
    });

    const host = await snapshotFor<HostActivities>(instructor, code, "instructor");
    expect(host.body.snapshot.activities[0]!.responseCount).toBe(1);

    const list = await instructor.get(
      `/api/rooms/${code}/activities/${created.body.id}/responses`,
    );
    expect((list.body as { responses: { answers: Record<string, string> }[] }).responses).toHaveLength(1);
    expect(
      (list.body as { responses: { answers: Record<string, string> }[] }).responses[0]!.answers.f1,
    ).toBe("second");
  });

  it("refuses an answer once the activity is closed", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Closing soon",
      openNow: true,
    });

    await instructor.post(`/api/rooms/${code}/activities/${created.body.id}`, { action: "close" });
    const late = await learner.post(
      `/api/rooms/${code}/activities/${created.body.id}/respond`,
      { answers: { f1: "too late" } },
    );
    expect(late.status).toBe(409);
  });

  it("running it again starts a fresh attempt and leaves the first one intact", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const first = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Build the first two tables",
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/activities/${first.body.id}/respond`, {
      answers: { f1: "attempt one" },
    });

    const again = await instructor.post<{ id: string }>(
      `/api/rooms/${code}/activities/${first.body.id}`,
      { action: "again" },
    );
    expect(again.body.id).not.toBe(first.body.id);

    await learner.post(`/api/rooms/${code}/activities/${again.body.id}/respond`, {
      answers: { f1: "attempt two" },
    });

    const original = await instructor.get(`/api/rooms/${code}/activities/${first.body.id}/responses`);
    const repeat = await instructor.get(`/api/rooms/${code}/activities/${again.body.id}/responses`);
    type List = { responses: { answers: Record<string, string> }[] };
    expect((original.body as List).responses[0]!.answers.f1).toBe("attempt one");
    expect((repeat.body as List).responses[0]!.answers.f1).toBe("attempt two");

    const host = await snapshotFor<HostActivities>(instructor, code, "instructor");
    expect(host.body.snapshot.activities.map((a) => a.attempt).sort()).toEqual([1, 2]);
  });

  it("will not let the questions change under answers already given", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Editable until answered",
      openNow: true,
    });

    const before = await instructor.patch(`/api/rooms/${code}/activities/${created.body.id}`, {
      fields: [{ label: "Changed", type: "short_text" }],
    });
    expect(before.status).toBe(200);

    await learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
      answers: { f1: "answered" },
    });

    const after = await instructor.patch(`/api/rooms/${code}/activities/${created.body.id}`, {
      fields: [{ label: "Changed again", type: "short_text" }],
    });
    expect(after.status).toBe(409);
  });

  it("keeps other learners out of everyone's submissions", async () => {
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");
    const grace = await joinAs(code, "Grace");

    const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Private until revealed",
      openNow: true,
    });
    await ada.learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
      answers: { f1: "Ada's private answer" },
    });

    const graceState = await snapshotFor(grace.learner, code, "learner");
    expect(JSON.stringify(graceState.body.snapshot)).not.toContain("Ada's private answer");

    const screen = await snapshotFor(new Client("screen"), code, "public");
    expect(JSON.stringify(screen.body.snapshot)).not.toContain("Ada's private answer");

    // And the named list is instructor-only.
    const stolen = await grace.learner.get(
      `/api/rooms/${code}/activities/${created.body.id}/responses`,
    );
    expect(stolen.status).toBe(403);
  });

  it("keeps the instructor's reference answer out of every other payload", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await instructor.post(`/api/rooms/${code}/activities`, {
      ...QUANTITY_EXERCISE,
      openNow: true,
    });

    const host = await snapshotFor<HostActivities>(instructor, code, "instructor");
    expect(host.body.snapshot.activities[0]!.referenceAnswer).toContain("order_items");

    for (const [client, role] of [
      [learner, "learner"],
      [new Client("screen"), "public"],
    ] as const) {
      const state = await snapshotFor(client, code, role);
      expect(JSON.stringify(state.body.snapshot)).not.toContain("quantity belongs to one product");
    }
  });

  it("keeps existing polls working alongside activities", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Is a Promise eager?",
      kind: "yes_no",
      openNow: true,
    });
    await instructor.post(`/api/rooms/${code}/activities`, { title: "And an activity", openNow: true });

    const answered = await learner.post(
      `/api/rooms/${code}/polls/${poll.body.pollId}/respond`,
      { value: "yes" },
    );
    expect(answered.status).toBe(200);

    const host = await snapshotFor<{ activePoll: { responseCount: number } | null }>(
      instructor,
      code,
      "instructor",
    );
    expect(host.body.snapshot.activePoll!.responseCount).toBe(1);
  });
});
