import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

/**
 * Ending the class, as the September 13 classroom will do it.
 *
 * The behaviours pinned here are the ones a live class depends on at the very
 * end of the lesson: ending is idempotent (a retry after a lost response must
 * not strand the instructor), everything still collecting is settled in the
 * same moment, learners keep what they submitted, and nothing accepts input
 * afterwards.
 */

interface EndedHostSnapshot {
  room: { status: string; endedAt: string | null };
  activePoll: { id: string; status: string } | null;
  polls: { id: string; status: string }[];
  activities: { id: string; status: string }[];
  timer: { id: string; status: string } | null;
  pulseRound: unknown;
  pulseHistory: { status: string; summary: { counts: Record<string, number> } }[];
}

interface EndedLearnerSnapshot {
  room: { status: string };
  me: { displayName: string; pulse: string | null };
  myAnswer: string | null;
  activePoll: { status: string } | null;
  pulseRound: unknown;
  activities: { id: string; status: string }[];
  mySubmissions: { activityId: string; answers: Record<string, string>; feedback: string | null }[];
  timer: unknown;
}

describe("ending the class", () => {
  it("is idempotent: ending an already-ended class is success, not an error", async () => {
    const { instructor, code } = await createRoom();

    const first = await instructor.post(`/api/rooms/${code}/end`);
    expect(first.status).toBe(200);

    // The retry an instructor sends when the first response was lost.
    const second = await instructor.post(`/api/rooms/${code}/end`);
    expect(second.status).toBe(200);

    const snapshot = await snapshotFor<EndedHostSnapshot>(instructor, code, "instructor");
    expect(snapshot.body.snapshot.room.status).toBe("ended");
    expect(snapshot.body.snapshot.room.endedAt).not.toBeNull();
  });

  it("settles everything still collecting: poll, activity, pulse round, timer", async () => {
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");

    // A class with every kind of collector live at once.
    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Following so far?",
      kind: "yes_no",
      openNow: true,
    });
    expect(poll.status).toBe(200);
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Name one table",
      fields: [{ label: "Table", type: "short_text" }],
      openNow: true,
    });
    expect(activity.status).toBe(200);
    const timer = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 300,
      label: "Exercise",
    });
    expect(timer.status).toBe(200);
    expect((await ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" })).status).toBe(
      200,
    );

    expect((await instructor.post(`/api/rooms/${code}/end`)).status).toBe(200);

    const host = await snapshotFor<EndedHostSnapshot>(instructor, code, "instructor");
    const state = host.body.snapshot;
    expect(state.room.status).toBe("ended");
    // Nothing may present itself as still collecting or still counting down.
    expect(state.activePoll).toBeNull();
    expect(state.polls[0]!.status).toBe("closed");
    expect(state.activities[0]!.status).toBe("closed");
    expect(state.timer).toBeNull();
    expect(state.pulseRound).toBeNull();
    // The round the class answered survives as history, with its answers.
    expect(state.pulseHistory[0]!.status).toBe("closed");
    expect(state.pulseHistory[0]!.summary.counts.shaky).toBe(1);
  });

  it("keeps a learner's submitted work visible to them after the end", async () => {
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");

    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Ready?",
      kind: "yes_no",
      openNow: true,
    });
    await ada.learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}/respond`, { value: "yes" });

    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "One takeaway",
      fields: [{ label: "Takeaway", type: "short_text" }],
      openNow: true,
    });
    const submitted = await ada.learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "Rows belong in order_items" } },
    );
    expect(submitted.status).toBe(200);
    await ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    expect((await instructor.post(`/api/rooms/${code}/end`)).status).toBe(200);

    // The refresh path: a fresh state read after the end, same identity.
    const after = await snapshotFor<EndedLearnerSnapshot>(ada.learner, code, "learner");
    expect(after.status).toBe(200);
    const snapshot = after.body.snapshot;
    expect(snapshot.room.status).toBe("ended");
    expect(snapshot.me.displayName).toBe("Ada");
    // Everything they sent is still theirs to see.
    expect(snapshot.myAnswer).toBe("yes");
    expect(snapshot.me.pulse).toBe("got_it");
    expect(snapshot.mySubmissions[0]!.answers.f1).toBe("Rows belong in order_items");
    expect(snapshot.activities.map((a) => a.id)).toContain(activity.body.id);
    // ...but nothing is presented as still collecting.
    expect(snapshot.activePoll?.status).toBe("closed");
    expect(snapshot.pulseRound).toBeNull();
    expect(snapshot.timer).toBeNull();
  });

  it("refuses every learner write after the end, with the ended message", async () => {
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");

    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Ready?",
      kind: "yes_no",
      openNow: true,
    });
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "One takeaway",
      fields: [{ label: "Takeaway", type: "short_text" }],
      openNow: true,
    });
    const question = await ada.learner.post<{ id: string }>(`/api/rooms/${code}/questions`, {
      body: "What is a foreign key?",
      anonymous: true,
    });
    expect(question.status).toBe(200);

    expect((await instructor.post(`/api/rooms/${code}/end`)).status).toBe(200);

    // The submission that was mid-flight when the class ended, for every kind
    // of live input. Each is refused as gone — never silently accepted, never
    // an opaque failure.
    const attempts = await Promise.all([
      ada.learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}/respond`, { value: "yes" }),
      ada.learner.post(`/api/rooms/${code}/pulse`, { pulse: "lost" }),
      ada.learner.post(`/api/rooms/${code}/activities/${activity.body.id}/respond`, {
        answers: { f1: "too late" },
      }),
      ada.learner.post(`/api/rooms/${code}/questions`, { body: "One more thing?", anonymous: true }),
      ada.learner.post(`/api/rooms/${code}/questions/${question.body.id}/vote`),
    ]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe(410);
      expect(JSON.stringify(attempt.body)).toContain("has ended");
    }
  });

  it("shows the ended state to a learner who reopens the class URL, and refuses a newcomer clearly", async () => {
    const { instructor, code } = await createRoom();
    const ada = await joinAs(code, "Ada");
    await instructor.post(`/api/rooms/${code}/end`);

    // Ada reopening the link: a state read with the cookie she already holds
    // must land her in the ended class, not on the join form and not an error.
    const back = await snapshotFor<EndedLearnerSnapshot>(ada.learner, code, "learner");
    expect(back.status).toBe(200);
    expect(back.body.snapshot.room.status).toBe("ended");

    // A newcomer who only now opens the URL is told plainly what happened.
    const late = new Client("late");
    const join = await late.post(`/api/rooms/${code}/join`, { displayName: "Late" });
    expect(join.status).toBe(410);
    expect(JSON.stringify(join.body)).toContain("has ended");
  });

  it("keeps instructor mutations refused after the end too", async () => {
    const { instructor, code } = await createRoom();
    await instructor.post(`/api/rooms/${code}/end`);

    const poll = await instructor.post(`/api/rooms/${code}/polls`, {
      prompt: "One more?",
      kind: "yes_no",
      openNow: true,
    });
    expect(poll.status).toBe(410);

    // The record of the session stays readable.
    expect((await instructor.get(`/api/rooms/${code}/summary`)).status).toBe(200);
  });
});
