import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface PlanResult {
  id: string;
  token: string;
  title: string;
}

async function preparedRoom() {
  const { instructor, code } = await createRoom("Day 30 — Introduction to SQL");

  for (const title of ["Why SQL Exists", "Database Structure", "DDL Practice"]) {
    await instructor.post(`/api/rooms/${code}/sections`, { title });
  }
  await instructor.post(`/api/rooms/${code}/activities`, {
    title: "Where does the quantity ordered belong?",
    fields: [
      { label: "Table", type: "choice", choices: ["products", "orders", "order_items"] },
      { label: "Why", type: "long_text" },
    ],
    referenceAnswer: "order_items",
    durationSeconds: 180,
  });
  await instructor.post(`/api/rooms/${code}/polls`, { prompt: "DDL or DML?", kind: "yes_no" });
  await instructor.post(`/api/rooms/${code}/materials`, {
    title: "PostgreSQL download",
    url: "https://www.postgresql.org/download/",
  });
  return { instructor, code };
}

describe("session plans", () => {
  it("saves a plan and starts a new class from it", async () => {
    const { instructor, code } = await preparedRoom();
    const saved = await instructor.post<PlanResult>(`/api/rooms/${code}/plan`, {
      title: "Day 30 plan",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.token.length).toBeGreaterThan(20);

    const next = new Client("next-day");
    const created = await next.post<{ code: string }>("/api/rooms", {
      title: "Day 30 — second cohort",
      planId: saved.body.id,
      planToken: saved.body.token,
    });
    expect(created.status).toBe(200);
    expect(created.body.code).not.toBe(code);

    const state = await snapshotFor<{
      sections: { title: string }[];
      activities: { title: string; status: string; referenceAnswer?: string | null }[];
      polls: { prompt: string; status: string }[];
      materials: { title: string }[];
    }>(next, created.body.code, "instructor");

    expect(state.body.snapshot.sections.map((s) => s.title)).toEqual([
      "Section 1",
      "Why SQL Exists",
      "Database Structure",
      "DDL Practice",
    ]);
    // Nothing is published by seeding: opening a room from a plan must not put
    // a question in front of a class before the instructor has said a word.
    expect(state.body.snapshot.activities[0]!.status).toBe("draft");
    expect(state.body.snapshot.polls[0]!.status).toBe("draft");
    expect(state.body.snapshot.activities[0]!.referenceAnswer).toBe("order_items");
    expect(state.body.snapshot.materials[0]!.title).toBe("PostgreSQL download");
  });

  it("never carries learner data into the new session", async () => {
    const { instructor, code } = await preparedRoom();
    const { learner } = await joinAs(code, "Ada");

    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Answer this",
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/activities/${activity.body.id}/respond`, {
      answers: { f1: "Ada's answer" },
    });
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await learner.post(`/api/rooms/${code}/questions`, { body: "Ada asked this" });
    await instructor.post(`/api/rooms/${code}/pick`);

    const saved = await instructor.post<PlanResult>(`/api/rooms/${code}/plan`, {});
    const next = new Client("next-day");
    const created = await next.post<{ code: string }>("/api/rooms", {
      planId: saved.body.id,
      planToken: saved.body.token,
    });

    const state = await snapshotFor<{
      roster: unknown[];
      questions: unknown[];
      picks: unknown[];
      pulseRound: unknown;
      pulseHistory: unknown[];
      activities: { responseCount: number }[];
    }>(next, created.body.code, "instructor");

    const text = JSON.stringify(state.body.snapshot);
    expect(text).not.toContain("Ada");
    expect(state.body.snapshot.roster).toHaveLength(0);
    expect(state.body.snapshot.questions).toHaveLength(0);
    expect(state.body.snapshot.picks).toHaveLength(0);
    expect(state.body.snapshot.pulseRound).toBeNull();
    expect(state.body.snapshot.pulseHistory).toHaveLength(0);
    expect(state.body.snapshot.activities.every((a) => a.responseCount === 0)).toBe(true);
  });

  it("gives the new room its own credentials", async () => {
    const { instructor, code } = await preparedRoom();
    const saved = await instructor.post<PlanResult>(`/api/rooms/${code}/plan`, {});

    const next = new Client("next-day");
    const created = await next.post<{ code: string }>("/api/rooms", {
      planId: saved.body.id,
      planToken: saved.body.token,
    });

    // The instructor of the source room is not the instructor of the new one.
    const outsider = await instructor.get(
      `/api/rooms/${created.body.code}/state?role=instructor`,
    );
    expect(outsider.status).toBe(403);
  });

  it("will not open a plan without its token", async () => {
    const { instructor, code } = await preparedRoom();
    const saved = await instructor.post<PlanResult>(`/api/rooms/${code}/plan`, {});

    const reader = new Client("reader");
    expect((await reader.post(`/api/plans/${saved.body.id}`, { token: "not-the-token" })).status)
      .toBe(404);
    expect(
      (await reader.post("/api/rooms", { planId: saved.body.id, planToken: "not-the-token" }))
        .status,
    ).toBe(404);

    const opened = await reader.post<{ plan: { payload: { activities: unknown[] } } }>(
      `/api/plans/${saved.body.id}`,
      { token: saved.body.token },
    );
    expect(opened.status).toBe(200);
    expect(opened.body.plan.payload.activities.length).toBeGreaterThan(0);
  });

  it("reuses one exercise on its own, without duplicating the whole plan", async () => {
    const { instructor, code } = await preparedRoom();
    const saved = await instructor.post<PlanResult>(`/api/rooms/${code}/plan`, {});
    const plan = await instructor.post<{ plan: { payload: { activities: { key: string }[] } } }>(
      `/api/plans/${saved.body.id}`,
      { token: saved.body.token },
    );

    const { instructor: other, code: otherCode } = await createRoom("Day 31");
    const reused = await other.post(`/api/rooms/${otherCode}/activities`, {
      title: "",
      fromPlan: {
        planId: saved.body.id,
        token: saved.body.token,
        key: plan.body.plan.payload.activities[0]!.key,
      },
      openNow: true,
    });
    expect(reused.status).toBe(200);

    const state = await snapshotFor<{
      activities: { title: string; fields: { type: string }[]; referenceAnswer?: string | null }[];
      sections: unknown[];
    }>(other, otherCode, "instructor");
    expect(state.body.snapshot.activities[0]!.title).toContain("quantity ordered");
    expect(state.body.snapshot.activities[0]!.fields.map((f) => f.type)).toEqual([
      "choice",
      "long_text",
    ]);
    expect(state.body.snapshot.activities[0]!.referenceAnswer).toBe("order_items");
    // Only the exercise came across; the plan's sections did not.
    expect(state.body.snapshot.sections).toHaveLength(1);
  });

  it("keeps historical sessions behind the instructor's own token", async () => {
    const { instructor, code } = await preparedRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/questions`, { body: "Which city buys the most?" });

    // The instructor can come back to the original session and read it.
    const revisit = await instructor.get<{ summary: { questions: { body: string }[] } }>(
      `/api/rooms/${code}/summary`,
    );
    expect(revisit.status).toBe(200);
    expect(revisit.body.summary.questions[0]!.body).toContain("city");

    // Knowing the room code is not enough to reach any of it.
    const stranger = new Client("stranger");
    expect((await stranger.get(`/api/rooms/${code}/summary`)).status).toBe(403);
    expect((await stranger.get(`/api/rooms/${code}/state?role=instructor`)).status).toBe(403);
  });
});
