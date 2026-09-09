import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

type Responses = {
  responses: {
    id: string;
    displayName: string;
    answers: Record<string, string>;
    reviewState: string;
    feedback: string | null;
    revealed: boolean;
  }[];
};

async function activityWithAnswers(title = "Explain your answer") {
  const { instructor, code } = await createRoom();
  const ada = await joinAs(code, "Ada");
  const grace = await joinAs(code, "Grace");
  const created = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
    title,
    openNow: true,
  });
  await ada.learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
    answers: { f1: "Ada says order_items" },
  });
  await grace.learner.post(`/api/rooms/${code}/activities/${created.body.id}/respond`, {
    answers: { f1: "Grace says orders" },
  });
  const list = await instructor.get<Responses>(
    `/api/rooms/${code}/activities/${created.body.id}/responses`,
  );
  return { instructor, code, ada, grace, activityId: created.body.id, list: list.body };
}

describe("review, feedback and discussion", () => {
  it("shows the instructor named submissions with a review state", async () => {
    const { list } = await activityWithAnswers();
    expect(list.responses.map((r) => r.displayName).sort()).toEqual(["Ada", "Grace"]);
    expect(list.responses.every((r) => r.reviewState === "pending")).toBe(true);
  });

  it("marks a response and filters what still needs attention", async () => {
    const { instructor, code, activityId, list } = await activityWithAnswers();

    await instructor.post(`/api/rooms/${code}/responses/${list.responses[0]!.id}`, {
      reviewState: "reviewed",
    });
    await instructor.post(`/api/rooms/${code}/responses/${list.responses[1]!.id}`, {
      reviewState: "needs_follow_up",
    });

    const host = await snapshotFor<{
      activities: { id: string; reviewCounts: Record<string, number> }[];
    }>(instructor, code, "instructor");
    const activity = host.body.snapshot.activities.find((a) => a.id === activityId)!;
    expect(activity.reviewCounts).toEqual({ pending: 0, reviewed: 1, needs_follow_up: 1 });
  });

  it("keeps private feedback between the instructor and its author", async () => {
    const { instructor, code, ada, grace, list } = await activityWithAnswers();
    const adaResponse = list.responses.find((r) => r.displayName === "Ada")!;

    await instructor.post(`/api/rooms/${code}/responses/${adaResponse.id}`, {
      feedback: "Right table, say why in terms of the bridge.",
      reviewState: "reviewed",
    });

    const mine = await snapshotFor<{ mySubmissions: { feedback: string | null }[] }>(
      ada.learner,
      code,
      "learner",
    );
    expect(mine.body.snapshot.mySubmissions[0]!.feedback).toContain("bridge");

    const theirs = await snapshotFor(grace.learner, code, "learner");
    expect(JSON.stringify(theirs.body.snapshot)).not.toContain("bridge");

    const screen = await snapshotFor(new Client("screen"), code, "public");
    expect(JSON.stringify(screen.body.snapshot)).not.toContain("bridge");
  });

  it("puts one response on the screen, anonymously unless the author is named", async () => {
    const { instructor, code, list } = await activityWithAnswers();
    const screen = new Client("screen");
    const adaResponse = list.responses.find((r) => r.displayName === "Ada")!;

    // Nothing on the projector until the instructor reveals a specific one.
    let shown = await snapshotFor<{ revealedResponse: unknown }>(screen, code, "public");
    expect(shown.body.snapshot.revealedResponse).toBeNull();

    await instructor.post(`/api/rooms/${code}/responses/${adaResponse.id}`, { reveal: true });
    shown = await snapshotFor<{
      room: { publicMode: string };
      revealedResponse: { answers: Record<string, string>; authorName: string | null } | null;
    }>(screen, code, "public");
    const revealed = shown.body.snapshot as unknown as {
      room: { publicMode: string };
      revealedResponse: { answers: Record<string, string>; authorName: string | null };
    };
    expect(revealed.room.publicMode).toBe("response");
    expect(revealed.revealedResponse.answers.f1).toBe("Ada says order_items");
    // Anonymous by default: the answer is the teaching point, the author is not.
    expect(revealed.revealedResponse.authorName).toBeNull();

    await instructor.post(`/api/rooms/${code}/responses/${adaResponse.id}`, {
      reveal: true,
      revealAuthor: true,
    });
    const named = await snapshotFor<{ revealedResponse: { authorName: string | null } }>(
      screen,
      code,
      "public",
    );
    expect(named.body.snapshot.revealedResponse.authorName).toBe("Ada");

    // Hiding it takes it off the screen again.
    await instructor.post(`/api/rooms/${code}/responses/${adaResponse.id}`, { reveal: false });
    const hidden = await snapshotFor<{ revealedResponse: unknown }>(screen, code, "public");
    expect(hidden.body.snapshot.revealedResponse).toBeNull();
  });

  it("reveals one at a time", async () => {
    const { instructor, code, list } = await activityWithAnswers();
    await instructor.post(`/api/rooms/${code}/responses/${list.responses[0]!.id}`, { reveal: true });
    await instructor.post(`/api/rooms/${code}/responses/${list.responses[1]!.id}`, { reveal: true });

    const screen = await snapshotFor<{ revealedResponse: { answers: Record<string, string> } }>(
      new Client("screen"),
      code,
      "public",
    );
    expect(screen.body.snapshot.revealedResponse.answers.f1).toBe(list.responses[1]!.answers.f1);
  });

  it("invites the author to explain, and records it in the picker history", async () => {
    const { instructor, code, ada, list } = await activityWithAnswers();
    const adaResponse = list.responses.find((r) => r.displayName === "Ada")!;

    await instructor.post(`/api/rooms/${code}/responses/${adaResponse.id}`, { invite: true });

    const mine = await snapshotFor<{ spotlight: boolean }>(ada.learner, code, "learner");
    expect(mine.body.snapshot.spotlight).toBe(true);

    const host = await snapshotFor<{ picks: { displayName: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    expect(host.body.snapshot.picks[0]!.displayName).toBe("Ada");
  });

  it("lets only the instructor review", async () => {
    const { code, grace, list } = await activityWithAnswers();
    const attempt = await grace.learner.post(`/api/rooms/${code}/responses/${list.responses[0]!.id}`, {
      reviewState: "reviewed",
    });
    expect(attempt.status).toBe(403);
  });
});
