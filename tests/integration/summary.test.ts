import { describe, expect, it } from "vitest";
import { createRoom, joinAs, snapshotFor } from "./client";

interface SummaryShape {
  learnersJoined: number;
  learnersParticipating: number;
  participationRate: number;
  pollsAsked: number;
  totalResponses: number;
  questionUpvotes: number;
  polls: { prompt: string; responseCount: number; tallies: { value: string; count: number }[] }[];
  questions: { body: string; votes: number; status: string; authorName: string | null }[];
  picks: { displayName: string }[];
  pulse: { counts: { got_it: number; shaky: number; lost: number }; responded: number };
  pulseUpdates: number;
}

describe("session summary", () => {
  it("reports what actually happened in the class", async () => {
    const { instructor, code } = await createRoom("Summary class");
    const ada = await joinAs(code, "Ada");
    const grace = await joinAs(code, "Grace");
    const alan = await joinAs(code, "Alan");

    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Understood?",
      kind: "yes_no",
      openNow: true,
    });
    await ada.learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}/respond`, {
      value: "yes",
    });
    await grace.learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}/respond`, {
      value: "no",
    });

    await ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });
    await grace.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" });
    await grace.learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" });

    await ada.learner.post(`/api/rooms/${code}/questions`, { body: "Worth a summary?" });
    const state = await snapshotFor<{ questions: { id: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    await grace.learner.post(
      `/api/rooms/${code}/questions/${state.body.snapshot.questions[0]!.id}/vote`,
    );

    await instructor.post(`/api/rooms/${code}/pick`);

    const result = await instructor.request<{ summary: SummaryShape }>(
      `/api/rooms/${code}/summary`,
    );
    const summary = result.body.summary;

    expect(result.status).toBe(200);
    expect(summary.learnersJoined).toBe(3);
    expect(summary.pollsAsked).toBe(1);
    expect(summary.totalResponses).toBe(2);
    expect(summary.polls[0]?.prompt).toBe("Understood?");
    expect(summary.polls[0]?.tallies.find((t) => t.value === "yes")?.count).toBe(1);
    expect(summary.questions).toHaveLength(1);
    expect(summary.questions[0]?.votes).toBe(1);
    expect(summary.questions[0]?.authorName).toBeNull();
    expect(summary.questionUpvotes).toBe(1);
    expect(summary.picks).toHaveLength(1);
    expect(summary.pulse.responded).toBe(2);
    expect(summary.pulse.counts.shaky).toBe(1);
    expect(summary.pulseUpdates).toBe(3);

    // Ada and Grace interacted; Alan only joined.
    expect(summary.learnersParticipating).toBe(2);
    expect(summary.participationRate).toBe(67);
    void alan;
  });

  it("is readable for a class where nothing happened", async () => {
    const { instructor, code } = await createRoom("Quiet class");
    const result = await instructor.request<{ summary: SummaryShape }>(
      `/api/rooms/${code}/summary`,
    );
    expect(result.status).toBe(200);
    expect(result.body.summary.learnersJoined).toBe(0);
    expect(result.body.summary.participationRate).toBe(0);
    expect(result.body.summary.polls).toEqual([]);
  });
});
