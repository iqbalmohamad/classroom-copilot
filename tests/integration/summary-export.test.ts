import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs } from "./client";

async function taughtSession() {
  const { instructor, code } = await createRoom("Day 30 — Introduction to SQL");
  const ada = await joinAs(code, "Ada");
  const grace = await joinAs(code, "Grace");

  const sections = await instructor.get<{ snapshot: { sections: { id: string }[] } }>(
    `/api/rooms/${code}/state?role=instructor`,
  );
  const first = sections.body.snapshot.sections[0]!.id;
  await instructor.patch(`/api/rooms/${code}/sections/${first}`, { title: "Why SQL Exists" });

  await ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
  await grace.learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" });
  await instructor.post(`/api/rooms/${code}/pulse/rounds`, { label: "After the explanation" });
  await ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

  const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
    title: "Where does the quantity ordered belong?",
    fields: [{ label: "Table", type: "short_text" }],
    referenceAnswer: "order_items",
    openNow: true,
  });
  await ada.learner.post(`/api/rooms/${code}/activities/${activity.body.id}/respond`, {
    answers: { f1: "order_items" },
  });
  const list = await instructor.get<{ responses: { id: string }[] }>(
    `/api/rooms/${code}/activities/${activity.body.id}/responses`,
  );
  await instructor.post(`/api/rooms/${code}/responses/${list.body.responses[0]!.id}`, {
    reviewState: "reviewed",
    feedback: "Exactly right.",
  });

  await ada.learner.post(`/api/rooms/${code}/questions`, {
    body: "Which city buys the most?",
    sectionId: first,
  });
  await instructor.post(`/api/rooms/${code}/materials`, {
    title: "PostgreSQL download",
    url: "https://www.postgresql.org/download/",
  });

  return { instructor, code };
}

describe("session summary and export", () => {
  it("reports pulse by section and round, activities, and questions in context", async () => {
    const { instructor, code } = await taughtSession();
    const result = await instructor.get<{
      summary: {
        sections: { title: string }[];
        pulseRounds: {
          seq: number;
          label: string | null;
          sectionTitle: string | null;
          summary: { counts: Record<string, number>; responded: number; total: number };
        }[];
        activities: {
          title: string;
          responseCount: number;
          reviewCounts: Record<string, number>;
          referenceAnswer: string | null;
          responses: { displayName: string; feedback: string | null }[];
        }[];
        activitySubmissions: number;
        questions: { sectionTitle: string | null; unresolved: boolean }[];
        materials: { title: string }[];
      };
    }>(`/api/rooms/${code}/summary`);

    const summary = result.body.summary;
    expect(summary.sections[0]!.title).toBe("Why SQL Exists");

    // Both rounds are there, in order, with the first one intact.
    expect(summary.pulseRounds).toHaveLength(2);
    expect(summary.pulseRounds[0]!.summary.counts).toMatchObject({ lost: 1, shaky: 1 });
    expect(summary.pulseRounds[1]!.label).toBe("After the explanation");
    expect(summary.pulseRounds[1]!.summary.counts.got_it).toBe(1);
    expect(summary.pulseRounds[0]!.sectionTitle).toBe("Why SQL Exists");

    expect(summary.activities[0]!.responseCount).toBe(1);
    expect(summary.activities[0]!.reviewCounts.reviewed).toBe(1);
    expect(summary.activities[0]!.referenceAnswer).toBe("order_items");
    expect(summary.activities[0]!.responses[0]!.displayName).toBe("Ada");
    expect(summary.activities[0]!.responses[0]!.feedback).toBe("Exactly right.");
    expect(summary.activitySubmissions).toBe(1);

    expect(summary.questions[0]!.sectionTitle).toBe("Why SQL Exists");
    expect(summary.questions[0]!.unresolved).toBe(true);
    expect(summary.materials[0]!.title).toBe("PostgreSQL download");
  });

  it("downloads as CSV, with formulas defused", async () => {
    const { instructor, code } = await createRoom("Injection check");
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Paste your SQL",
      fields: [{ label: "SQL", type: "sql" }],
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/activities/${activity.body.id}/respond`, {
      answers: { f1: '=HYPERLINK("http://evil.test","click me")' },
    });

    const csv = await instructor.get<{ raw: string }>(`/api/rooms/${code}/summary?format=csv`);
    expect(csv.status).toBe(200);
    const text = csv.body.raw;

    // The learner's answer is present, but as text a spreadsheet will not run.
    expect(text).toContain("HYPERLINK");
    expect(text).not.toMatch(/,"=HYPERLINK/);
    expect(text).toContain(`"'=HYPERLINK`);
    expect(text).toContain("Ada");
  });

  it("keeps the whole summary and the export behind the instructor's token", async () => {
    const { code } = await taughtSession();
    const stranger = new Client("stranger");
    expect((await stranger.get(`/api/rooms/${code}/summary`)).status).toBe(403);
    expect((await stranger.get(`/api/rooms/${code}/summary?format=csv`)).status).toBe(403);

    const { learner } = await joinAs(code, "Curious");
    expect((await learner.get(`/api/rooms/${code}/summary?format=csv`)).status).toBe(403);
  });

  it("never attributes a pulse, even in the export", async () => {
    const { instructor, code } = await taughtSession();
    const csv = await instructor.get<{ raw: string }>(`/api/rooms/${code}/summary?format=csv`);
    for (const line of csv.body.raw.split("\r\n")) {
      if (!line.startsWith('"pulse"')) continue;
      expect(line).not.toContain("Ada");
      expect(line).not.toContain("Grace");
    }
  });
});
