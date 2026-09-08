import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface QuestionShape {
  id: string;
  body: string;
  votes: number;
  status: string;
  votedByMe: boolean | null;
  authorName?: string | null;
}

interface WithQuestions {
  questions: QuestionShape[];
}

async function questions(client: Client, code: string, role: string) {
  const state = await snapshotFor<WithQuestions>(client, code, role);
  return state.body.snapshot.questions;
}

describe("anonymous question box", () => {
  it("delivers a learner's question to the instructor without naming them", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await learner.post(`/api/rooms/${code}/questions`, {
      body: "Why does await block here?",
      anonymous: true,
    });

    const forInstructor = await questions(instructor, code, "instructor");
    expect(forInstructor).toHaveLength(1);
    expect(forInstructor[0]?.body).toBe("Why does await block here?");
    expect(forInstructor[0]?.authorName).toBeNull();
  });

  it("shows the name only when the learner chose not to be anonymous", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await learner.post(`/api/rooms/${code}/questions`, { body: "Named question", anonymous: false });

    const forInstructor = await questions(instructor, code, "instructor");
    expect(forInstructor[0]?.authorName).toBe("Ada");

    // Other learners still never see who asked.
    const other = await joinAs(code, "Grace");
    const forLearner = await questions(other.learner, code, "learner");
    expect(JSON.stringify(forLearner)).not.toContain("Ada");
  });

  it("counts at most one upvote per learner however many times they tap", async () => {
    const { instructor, code } = await createRoom();
    const { learner: asker } = await joinAs(code, "Ada");
    const { learner: voter } = await joinAs(code, "Grace");

    await asker.post(`/api/rooms/${code}/questions`, { body: "Can we see an example?" });
    const [question] = await questions(instructor, code, "instructor");

    // Tap, tap, tap — a toggle, so it can never accumulate.
    await voter.post(`/api/rooms/${code}/questions/${question!.id}/vote`);
    expect((await questions(instructor, code, "instructor"))[0]?.votes).toBe(1);

    await voter.post(`/api/rooms/${code}/questions/${question!.id}/vote`);
    expect((await questions(instructor, code, "instructor"))[0]?.votes).toBe(0);

    await voter.post(`/api/rooms/${code}/questions/${question!.id}/vote`);
    expect((await questions(instructor, code, "instructor"))[0]?.votes).toBe(1);
  });

  it("holds at one vote per learner even under rapid concurrent taps", async () => {
    const { instructor, code } = await createRoom();
    const { learner: asker } = await joinAs(code, "Ada");
    const { learner: voter } = await joinAs(code, "Grace");

    await asker.post(`/api/rooms/${code}/questions`, { body: "Rapid tapping" });
    const [question] = await questions(instructor, code, "instructor");

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        voter.post(`/api/rooms/${code}/questions/${question!.id}/vote`),
      ),
    );

    // Every tap must succeed — five of six failing with a 500 would otherwise
    // satisfy a bare "the count is 0 or 1" assertion.
    expect(results.filter((r) => r.status !== 200)).toEqual([]);

    // Six serialised toggles from one learner: on, off, on, off, on, off.
    const votes = (await questions(instructor, code, "instructor"))[0]?.votes ?? -1;
    expect(votes).toBe(0);
  });

  it("adds up votes from different learners", async () => {
    const { instructor, code } = await createRoom();
    const { learner: asker } = await joinAs(code, "Ada");
    await asker.post(`/api/rooms/${code}/questions`, { body: "Popular question" });
    const [question] = await questions(instructor, code, "instructor");

    const voters = await Promise.all(
      Array.from({ length: 5 }, (_, i) => joinAs(code, `V${i + 1}`)),
    );
    await Promise.all(
      voters.map(({ learner }) => learner.post(`/api/rooms/${code}/questions/${question!.id}/vote`)),
    );

    expect((await questions(instructor, code, "instructor"))[0]?.votes).toBe(5);
  });

  it("tells a learner which questions they have already upvoted", async () => {
    const { instructor, code } = await createRoom();
    const { learner: asker } = await joinAs(code, "Ada");
    const { learner: voter } = await joinAs(code, "Grace");
    await asker.post(`/api/rooms/${code}/questions`, { body: "Mine" });
    const [question] = await questions(instructor, code, "instructor");

    await voter.post(`/api/rooms/${code}/questions/${question!.id}/vote`);

    const asVoter = await questions(voter, code, "learner");
    expect(asVoter[0]?.votedByMe).toBe(true);
    const asAsker = await questions(asker, code, "learner");
    expect(asAsker[0]?.votedByMe).toBe(false);
  });

  it("lets the instructor mark a question answered and reopen it", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/questions`, { body: "Answer me" });
    const [question] = await questions(instructor, code, "instructor");

    await instructor.post(`/api/rooms/${code}/questions/${question!.id}`, { action: "answer" });
    expect((await questions(instructor, code, "instructor"))[0]?.status).toBe("answered");

    await instructor.post(`/api/rooms/${code}/questions/${question!.id}`, { action: "reopen" });
    expect((await questions(instructor, code, "instructor"))[0]?.status).toBe("open");
  });

  it("removes a hidden question from every learner's screen", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/questions`, { body: "Please remove me" });
    const [question] = await questions(instructor, code, "instructor");

    await instructor.post(`/api/rooms/${code}/questions/${question!.id}`, { action: "hide" });

    expect(await questions(learner, code, "learner")).toHaveLength(0);
    // The instructor still has the record.
    expect((await questions(instructor, code, "instructor"))[0]?.status).toBe("hidden");

    // And it can no longer be upvoted.
    const vote = await learner.post(`/api/rooms/${code}/questions/${question!.id}/vote`);
    expect(vote.status).toBe(404);
  });

  it("rejects an empty question", async () => {
    const { code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const result = await learner.post(`/api/rooms/${code}/questions`, { body: " " });
    expect(result.status).toBe(400);
  });

  it("stores question text verbatim so it cannot be smuggled as markup", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const nasty = '<img src=x onerror="alert(1)">';
    await learner.post(`/api/rooms/${code}/questions`, { body: nasty });

    const stored = await questions(instructor, code, "instructor");
    expect(stored[0]?.body).toBe(nasty);
  });
});
