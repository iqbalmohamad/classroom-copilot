import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface PollShape {
  id: string;
  status: string;
  revealed: boolean;
  responseCount: number;
  options: { value: string; label: string }[];
  tallies: { value: string; count: number; percent: number }[] | null;
}

interface InstructorSnapshot {
  activePoll: PollShape | null;
  polls: PollShape[];
  roster: { displayName: string; answeredActivePoll: boolean }[];
}

interface LearnerSnapshot {
  activePoll: PollShape | null;
  myAnswer: string | null;
}

async function openPoll(
  instructor: Client,
  code: string,
  body: Record<string, unknown>,
): Promise<string> {
  const created = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
    openNow: true,
    ...body,
  });
  expect(created.status).toBe(200);
  return created.body.pollId;
}

describe("polls", () => {
  it("supports all three M0 question types with the expected options", async () => {
    const { instructor, code } = await createRoom();

    await openPoll(instructor, code, { prompt: "Clear so far?", kind: "yes_no" });
    let state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll?.options.map((o) => o.value)).toEqual(["yes", "no"]);

    await openPoll(instructor, code, {
      prompt: "Which one?",
      kind: "multiple_choice",
      choiceLabels: ["Array", "Object", "Map", "Set"],
    });
    state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll?.options.map((o) => o.value)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(state.body.snapshot.activePoll?.options[0]?.label).toBe("A. Array");

    await openPoll(instructor, code, { prompt: "How confident?", kind: "confidence" });
    state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll?.options.map((o) => o.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("keeps exactly one poll open at a time", async () => {
    const { instructor, code } = await createRoom();
    const first = await openPoll(instructor, code, { prompt: "First", kind: "yes_no" });
    const second = await openPoll(instructor, code, { prompt: "Second", kind: "yes_no" });

    const state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll?.id).toBe(second);
    expect(state.body.snapshot.polls.filter((p) => p.status === "open")).toHaveLength(1);
    expect(state.body.snapshot.polls.find((p) => p.id === first)?.status).toBe("closed");
  });

  it("records one answer per learner and lets them change it while open", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const pollId = await openPoll(instructor, code, { prompt: "Clear?", kind: "yes_no" });

    await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "yes" });
    await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "no" });
    await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "no" });

    const state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll?.responseCount).toBe(1);
    const tallies = state.body.snapshot.activePoll?.tallies ?? [];
    expect(tallies.find((t) => t.value === "no")?.count).toBe(1);
    expect(tallies.find((t) => t.value === "yes")?.count).toBe(0);

    const mine = await snapshotFor<LearnerSnapshot>(learner, code, "learner");
    expect(mine.body.snapshot.myAnswer).toBe("no");
  });

  it("counts many simultaneous answers exactly once each", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      Array.from({ length: 15 }, (_, i) => joinAs(code, `L${i + 1}`)),
    );
    const pollId = await openPoll(instructor, code, { prompt: "Ready?", kind: "yes_no" });

    // Everyone taps at once, and several tap twice.
    await Promise.all(
      learners.flatMap(({ learner }, index) => {
        const value = index % 2 === 0 ? "yes" : "no";
        const calls = [learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value })];
        if (index % 3 === 0) {
          calls.push(learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value }));
        }
        return calls;
      }),
    );

    const state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll?.responseCount).toBe(15);
    const total = (state.body.snapshot.activePoll?.tallies ?? []).reduce(
      (sum, t) => sum + t.count,
      0,
    );
    expect(total).toBe(15);
  });

  it("rejects answers once the poll is closed", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const pollId = await openPoll(instructor, code, { prompt: "Clear?", kind: "yes_no" });

    await instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "close" });
    const late = await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, {
      value: "yes",
    });

    expect(late.status).toBe(409);
    expect(JSON.stringify(late.body)).toContain("closed");
  });

  it("does not lose answers that were already in flight when a poll closes", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      Array.from({ length: 10 }, (_, i) => joinAs(code, `R${i + 1}`)),
    );
    const pollId = await openPoll(instructor, code, { prompt: "Go", kind: "yes_no" });

    // Close while responses are arriving: every call must resolve to a clear
    // accept or a clear rejection, never a server error or a lost write.
    const responses = await Promise.all([
      ...learners.map(({ learner }) =>
        learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "yes" }),
      ),
      instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "close" }),
    ]);

    for (const result of responses) {
      expect([200, 409]).toContain(result.status);
    }

    const state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    const poll = state.body.snapshot.polls.find((p) => p.id === pollId);
    const accepted = responses.filter((r) => r.status === 200).length - 1; // minus the close
    expect(poll?.responseCount).toBe(accepted);
  });

  it("rejects an answer that is not one of the offered options", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const pollId = await openPoll(instructor, code, { prompt: "Clear?", kind: "yes_no" });

    const result = await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, {
      value: "maybe",
    });
    expect(result.status).toBe(400);
  });

  it("reveals aggregates to learners and the screen only when the instructor says so", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const projector = new Client("projector");
    const pollId = await openPoll(instructor, code, { prompt: "Clear?", kind: "yes_no" });
    await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "yes" });

    // Before reveal: the instructor can see the split, nobody else can.
    const hostBefore = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(hostBefore.body.snapshot.activePoll?.tallies).not.toBeNull();

    const learnerBefore = await snapshotFor<LearnerSnapshot>(learner, code, "learner");
    expect(learnerBefore.body.snapshot.activePoll?.tallies).toBeNull();

    const publicBefore = await snapshotFor<{ activePoll: PollShape | null }>(
      projector,
      code,
      "public",
    );
    expect(publicBefore.body.snapshot.activePoll?.tallies).toBeNull();

    await instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "reveal" });

    const learnerAfter = await snapshotFor<LearnerSnapshot>(learner, code, "learner");
    expect(learnerAfter.body.snapshot.activePoll?.tallies).not.toBeNull();

    const publicAfter = await snapshotFor<{ activePoll: PollShape | null }>(
      projector,
      code,
      "public",
    );
    expect(publicAfter.body.snapshot.activePoll?.tallies).not.toBeNull();

    // ...and hiding takes it back off the shared screen.
    await instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "hide" });
    const publicHidden = await snapshotFor<{ activePoll: PollShape | null }>(
      projector,
      code,
      "public",
    );
    expect(publicHidden.body.snapshot.activePoll?.tallies).toBeNull();
  });

  it("can reopen a poll that was closed by mistake", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const pollId = await openPoll(instructor, code, { prompt: "Clear?", kind: "yes_no" });

    await instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "close" });
    const reopened = await instructor.post(`/api/rooms/${code}/polls/${pollId}`, {
      action: "open",
    });
    expect(reopened.status).toBe(200);

    const accepted = await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, {
      value: "yes",
    });
    expect(accepted.status).toBe(200);
  });

  it("shows the instructor who has answered, but never what they answered", async () => {
    const { instructor, code } = await createRoom();
    const { learner: ada } = await joinAs(code, "Ada");
    await joinAs(code, "Grace");
    const pollId = await openPoll(instructor, code, { prompt: "Clear?", kind: "yes_no" });
    await ada.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "no" });

    const state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    const roster = state.body.snapshot.roster;
    expect(roster.find((r) => r.displayName === "Ada")?.answeredActivePoll).toBe(true);
    expect(roster.find((r) => r.displayName === "Grace")?.answeredActivePoll).toBe(false);

    // No per-learner answer value appears anywhere in the payload.
    expect(JSON.stringify(roster)).not.toContain('"no"');
  });

  it("can save a poll without opening it", async () => {
    const { instructor, code } = await createRoom();
    const created = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Later",
      kind: "yes_no",
      openNow: false,
    });
    const state = await snapshotFor<InstructorSnapshot>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll).toBeNull();
    expect(state.body.snapshot.polls.find((p) => p.id === created.body.pollId)?.status).toBe(
      "draft",
    );
  });
});
