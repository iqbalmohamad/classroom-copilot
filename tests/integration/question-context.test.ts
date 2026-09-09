import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor } from "./client";

interface HostQuestions {
  questions: {
    id: string;
    body: string;
    sectionId: string | null;
    sectionTitle: string | null;
    activityId: string | null;
    activityTitle: string | null;
    status: string;
    votes: number;
  }[];
  sections: { id: string; title: string }[];
  activities: { id: string; title: string }[];
}

const questions = async (client: Parameters<typeof snapshotFor>[0], code: string, role: string) =>
  (await snapshotFor<HostQuestions>(client, code, role)).body.snapshot;

describe("questions in context", () => {
  it("records the section a question was asked in, and never relabels it", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const first = (await questions(instructor, code, "instructor")).sections[0]!;
    await instructor.patch(`/api/rooms/${code}/sections/${first.id}`, { title: "Why SQL Exists" });

    await learner.post(`/api/rooms/${code}/questions`, {
      body: "Which city buys the most?",
      sectionId: first.id,
    });

    // Move the class on twice. The question keeps the label it was asked under.
    await instructor.post(`/api/rooms/${code}/sections/select`, {});
    await instructor.post(`/api/rooms/${code}/sections/select`, {});

    const state = await questions(instructor, code, "instructor");
    expect(state.questions[0]!.sectionTitle).toBe("Why SQL Exists");
    expect(state.questions[0]!.sectionId).toBe(first.id);
  });

  it("attaches a question to the activity it is about", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Build the first two tables",
      openNow: true,
    });
    await learner.post(`/api/rooms/${code}/questions`, {
      body: "Does SERIAL need NOT NULL as well?",
      activityId: activity.body.id,
    });

    const state = await questions(instructor, code, "instructor");
    expect(state.questions[0]!.activityTitle).toBe("Build the first two tables");
    // The activity's own section is inherited, so the queue can group by either.
    expect(state.questions[0]!.sectionId).not.toBeNull();
  });

  it("keeps a general question general", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/questions`, { body: "Unrelated but useful" });

    const state = await questions(instructor, code, "instructor");
    expect(state.questions[0]!.sectionId).toBeNull();
    expect(state.questions[0]!.activityId).toBeNull();
  });

  it("survives a context that belongs to another class", async () => {
    const { code } = await createRoom();
    const other = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    const foreign = (await questions(other.instructor, other.code, "instructor")).sections[0]!;
    const asked = await learner.post(`/api/rooms/${code}/questions`, {
      body: "Sent during a section change",
      sectionId: foreign.id,
    });

    // Losing the question would be worse than losing its label.
    expect(asked.status).toBe(200);
    const state = await questions(learner, code, "learner");
    expect(state.questions[0]!.sectionId).toBeNull();
  });

  it("keeps anonymity, upvotes and moderation exactly as they were", async () => {
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");
    const grace = await joinAs(code, "Grace");

    const anonymous = await ada.learner.post<{ id: string }>(`/api/rooms/${code}/questions`, {
      body: "Anonymous by default",
    });
    await ada.learner.post(`/api/rooms/${code}/questions`, {
      body: "Named on purpose",
      anonymous: false,
    });

    const host = await questions(instructor, code, "instructor");
    const named = host.questions.find((q) => q.body === "Named on purpose")!;
    const hidden = host.questions.find((q) => q.body === "Anonymous by default")!;
    expect((named as unknown as { authorName: string }).authorName).toBe("Ada");
    expect((hidden as unknown as { authorName: string | null }).authorName).toBeNull();

    // Learners never see authorship either way.
    const seen = await questions(grace.learner, code, "learner");
    expect(JSON.stringify(seen.questions)).not.toContain("Ada");

    await grace.learner.post(`/api/rooms/${code}/questions/${anonymous.body.id}/vote`);
    expect((await questions(instructor, code, "instructor")).questions.find(
      (q) => q.id === anonymous.body.id,
    )!.votes).toBe(1);

    await instructor.post(`/api/rooms/${code}/questions/${anonymous.body.id}`, { action: "answer" });
    expect(
      (await questions(instructor, code, "instructor")).questions.find(
        (q) => q.id === anonymous.body.id,
      )!.status,
    ).toBe("answered");
  });
});
