import { describe, expect, it } from "vitest";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

interface WithTimer {
  timer: {
    id: string;
    label: string;
    status: string;
    endsAt: string | null;
    remainingSeconds: number | null;
    autoClose: boolean;
    expired: boolean;
  } | null;
}

const timerOf = async (client: Client, code: string, role = "instructor") =>
  (await snapshotFor<WithTimer>(client, code, role)).body.snapshot.timer;

describe("timers", () => {
  it("shows the same deadline to the instructor, the learners and the screen", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const screen = new Client("screen");

    const started = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 240,
      label: "Write one question",
    });
    expect(started.status).toBe(200);

    const [host, phone, projector] = await Promise.all([
      timerOf(instructor, code),
      timerOf(learner, code, "learner"),
      timerOf(screen, code, "public"),
    ]);

    // A stored deadline, not three countdowns drifting apart.
    expect(host!.endsAt).toBe(phone!.endsAt);
    expect(host!.endsAt).toBe(projector!.endsAt);
    expect(phone!.label).toBe("Write one question");
  });

  it("pauses, resumes and extends", async () => {
    const { instructor, code } = await createRoom();
    const started = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 300,
    });
    const id = started.body.id;

    await instructor.post(`/api/rooms/${code}/timers/${id}`, { action: "pause" });
    let timer = await timerOf(instructor, code);
    expect(timer!.status).toBe("paused");
    expect(timer!.remainingSeconds).toBeGreaterThan(280);
    expect(timer!.endsAt).toBeNull();

    await instructor.post(`/api/rooms/${code}/timers/${id}`, { action: "extend", seconds: 60 });
    timer = await timerOf(instructor, code);
    expect(timer!.remainingSeconds).toBeGreaterThan(340);

    await instructor.post(`/api/rooms/${code}/timers/${id}`, { action: "resume" });
    timer = await timerOf(instructor, code);
    expect(timer!.status).toBe("running");
    expect(timer!.endsAt).not.toBeNull();
  });

  it("closes the activity by itself when the time runs out", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Ten seconds",
      openNow: true,
    });

    await instructor.post(`/api/rooms/${code}/timers`, {
      durationSeconds: 10,
      activityId: activity.body.id,
      autoClose: true,
    });

    // Nothing here waits for an instructor browser: the learner's own read is
    // what applies the deadline.
    await new Promise((resolve) => setTimeout(resolve, 11_000));

    const phone = await snapshotFor<{ activities: { status: string }[] }>(learner, code, "learner");
    expect(phone.body.snapshot.activities.some((a) => a.status === "open")).toBe(false);

    const late = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "after the bell" } },
    );
    expect(late.status).toBe(409);

    const host = await snapshotFor<{ activities: { id: string; status: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    expect(host.body.snapshot.activities.find((a) => a.id === activity.body.id)!.status).toBe(
      "closed",
    );
  }, 30_000);

  it("refuses an answer after the deadline with no state read in between", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Ten seconds, unattended",
      openNow: true,
    });
    await instructor.post(`/api/rooms/${code}/timers`, {
      durationSeconds: 10,
      activityId: activity.body.id,
      autoClose: true,
    });

    // Nobody reads the room while the clock runs: no console, no phone, no
    // projector. The write itself has to apply the deadline.
    await new Promise((resolve) => setTimeout(resolve, 11_000));

    const late = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "after the bell" } },
    );
    expect(late.status).toBe(409);

    // ...and the closure it applied is complete, not half done: the timer is
    // ended and the activity is closed, in the same transaction.
    const host = await snapshotFor<{
      timer: unknown;
      activities: { id: string; status: string; responseCount: number }[];
    }>(instructor, code, "instructor");
    expect(host.body.snapshot.timer).toBeNull();
    const after = host.body.snapshot.activities.find((a) => a.id === activity.body.id)!;
    expect(after.status).toBe("closed");
    expect(after.responseCount).toBe(0);
  }, 30_000);

  it("refuses to pause, resume or extend an elapsed timer with no state read first", async () => {
    for (const action of ["pause", "resume", "extend"] as const) {
      const { instructor, code } = await createRoom();
      const started = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
        durationSeconds: 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 11_000));

      const result = await instructor.post(`/api/rooms/${code}/timers/${started.body.id}`, {
        action,
        seconds: action === "extend" ? 60 : undefined,
      });
      // Whatever the console still shows, the timer has finished; acting on it
      // says so rather than quietly resurrecting it.
      expect(result.status, action).toBe(409);
      expect(
        String((result.body as { error: { message: string } }).error.message),
        action,
      ).toContain("finished");
    }
  }, 60_000);

  it("keeps a submission racing the deadline all-or-nothing", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      Array.from({ length: 6 }, (_, i) => joinAs(code, `P${i + 1}`)),
    );
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Racing the bell",
      openNow: true,
    });
    await instructor.post(`/api/rooms/${code}/timers`, {
      durationSeconds: 10,
      activityId: activity.body.id,
      autoClose: true,
    });

    // Two bursts straddling the deadline, so some requests are genuinely racing
    // the expiry that others trigger.
    await new Promise((resolve) => setTimeout(resolve, 9_600));
    const submit = (entry: (typeof learners)[number]) =>
      entry.learner.post(`/api/rooms/${code}/activities/${activity.body.id}/respond`, {
        answers: { f1: "on the line" },
      });

    const early = await Promise.all(learners.slice(0, 3).map(submit));
    await new Promise((resolve) => setTimeout(resolve, 800));
    const late = await Promise.all(learners.slice(3).map(submit));
    const results = [...early, ...late];

    // Each answer either landed or was refused — never a 500, and never a
    // recorded answer for an activity the same request had just closed.
    const accepted = results.filter((r) => r.status === 200).length;
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);

    const list = await instructor.get<{ responses: unknown[] }>(
      `/api/rooms/${code}/activities/${activity.body.id}/responses`,
    );
    expect(list.body.responses).toHaveLength(accepted);

    const host = await snapshotFor<{ activities: { id: string; status: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    expect(host.body.snapshot.activities.find((a) => a.id === activity.body.id)!.status).toBe(
      "closed",
    );
  }, 40_000);

  it("refuses to extend a timer that has already finished", async () => {
    const { instructor, code } = await createRoom();
    const started = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 300,
    });
    await instructor.post(`/api/rooms/${code}/timers/${started.body.id}`, { action: "end" });

    const extended = await instructor.post(`/api/rooms/${code}/timers/${started.body.id}`, {
      action: "extend",
      seconds: 60,
    });
    // Silently reopening submissions the class was told were closed is the
    // failure this refuses.
    expect(extended.status).toBe(409);
    expect(String((extended.body as { error: { message: string } }).error.message)).toContain(
      "reopen the activity yourself",
    );
  });

  it("ending by hand honours the auto-close the instructor chose", async () => {
    const { instructor, code } = await createRoom();
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Stop now",
      openNow: true,
    });
    const timer = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 600,
      activityId: activity.body.id,
      autoClose: true,
    });

    await instructor.post(`/api/rooms/${code}/timers/${timer.body.id}`, { action: "end" });

    const host = await snapshotFor<{ activities: { id: string; status: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    expect(host.body.snapshot.activities[0]!.status).toBe("closed");
  });

  it("runs one clock at a time and lets only the instructor drive it", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");

    await instructor.post(`/api/rooms/${code}/timers`, { durationSeconds: 300, label: "First" });
    await instructor.post(`/api/rooms/${code}/timers`, { durationSeconds: 600, label: "Break" });
    expect((await timerOf(instructor, code))!.label).toBe("Break");

    const attempt = await learner.post(`/api/rooms/${code}/timers`, { durationSeconds: 60 });
    expect(attempt.status).toBe(403);
  });
});
