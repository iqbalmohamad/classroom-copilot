import { describe, expect, it } from "vitest";
import postgres from "postgres";
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

function db() {
  const url = process.env.CC_TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

/**
 * Move a running timer's deadline into the past, directly in the database.
 *
 * This is the deadline genuinely elapsing, minus the wait: no app code runs,
 * so nothing has had a chance to enforce anything when the test's next
 * request arrives.
 */
async function ageTimer(code: string) {
  const sql = db();
  try {
    await sql`
      update timers set ends_at = now() - make_interval(secs => 1)
      where room_id = (select id from rooms where code = ${code}) and status = 'running'`;
  } finally {
    await sql.end();
  }
}

/**
 * What the database actually holds — read with a plain connection, not an API
 * route. A snapshot request would enforce deadlines itself on the way, so it
 * cannot distinguish "the 409 committed the expiry" from "the 409 rolled the
 * expiry back and this very read repaired it". This can.
 */
async function committed(activityId: string, timerId: string) {
  const sql = db();
  try {
    const timers = await sql<{ status: string; expired: boolean }[]>`
      select status, expired from timers where id = ${timerId}`;
    const acts = await sql<{ status: string }[]>`
      select status from activities where id = ${activityId}`;
    const counts = await sql<{ n: number }[]>`
      select count(*)::int as n from activity_responses where activity_id = ${activityId}`;
    return { timer: timers[0], activity: acts[0]?.status, responses: counts[0]!.n };
  } finally {
    await sql.end();
  }
}

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
      title: "Unattended",
      openNow: true,
    });
    const bell = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 600,
      activityId: activity.body.id,
      autoClose: true,
    });

    // Nobody reads the room while the clock runs out: no console, no phone,
    // no projector. The rejected write itself has to apply the deadline.
    await ageTimer(code);
    const late = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "after the bell" } },
    );
    expect(late.status).toBe(409);

    // Inspect the database directly, before any snapshot or other app read:
    // the expiry and the closure the 409 reported must have been committed by
    // that same rejected request, not repaired later by whoever looks next.
    const state = await committed(activity.body.id, bell.body.id);
    expect(state.timer).toMatchObject({ status: "ended", expired: true });
    expect(state.activity).toBe("closed");
    expect(state.responses).toBe(0);
  });

  it("keeps the bell settled through a refusal, a break timer and a retry", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Before the break",
      openNow: true,
    });
    const bell = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 600,
      activityId: activity.body.id,
      autoClose: true,
    });

    // The deadline passes with no snapshot reads.
    await ageTimer(code);

    // A late answer is refused — and the refusal must not undo the expiry.
    const late = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "late" } },
    );
    expect(late.status).toBe(409);

    // The instructor starts a standalone break clock without a glance at
    // state. Replacing the ended bell must not disturb what it closed.
    const brk = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 300,
      label: "Break",
    });
    expect(brk.status).toBe(200);

    // The break clock is a fresh clock, not a reopened exercise.
    const retry = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "during the break" } },
    );
    expect(retry.status).toBe(409);

    const state = await committed(activity.body.id, bell.body.id);
    expect(state.timer).toMatchObject({ status: "ended", expired: true });
    expect(state.activity).toBe("closed");
    expect(state.responses).toBe(0);
  });

  it("settles an elapsed auto-close even when the next write is a new timer", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Straight to the break",
      openNow: true,
    });
    const bell = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 600,
      activityId: activity.body.id,
      autoClose: true,
    });
    await ageTimer(code);

    // The very first write after the deadline is the replacement timer
    // itself. "End every live timer" must not swallow the elapsed bell's
    // obligation to close its activity on the way.
    const brk = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 300,
      label: "Break",
    });
    expect(brk.status).toBe(200);

    const late = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "during the break" } },
    );
    expect(late.status).toBe(409);

    const state = await committed(activity.body.id, bell.body.id);
    expect(state.timer).toMatchObject({ status: "ended", expired: true });
    expect(state.activity).toBe("closed");
    expect(state.responses).toBe(0);
  });

  it("reopens after the bell only by the instructor's own action", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const activity = await instructor.post<{ id: string }>(`/api/rooms/${code}/activities`, {
      title: "Second wind",
      openNow: true,
    });
    const bell = await instructor.post<{ id: string }>(`/api/rooms/${code}/timers`, {
      durationSeconds: 600,
      activityId: activity.body.id,
      autoClose: true,
    });
    await ageTimer(code);

    const late = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "too late" } },
    );
    expect(late.status).toBe(409);

    // No timer, no side door: taking more answers is the instructor's own
    // explicit Open action, nothing else.
    const reopened = await instructor.post(`/api/rooms/${code}/activities/${activity.body.id}`, {
      action: "open",
    });
    expect(reopened.status).toBe(200);

    const accepted = await learner.post(
      `/api/rooms/${code}/activities/${activity.body.id}/respond`,
      { answers: { f1: "second wind" } },
    );
    expect(accepted.status).toBe(200);

    const state = await committed(activity.body.id, bell.body.id);
    expect(state.timer).toMatchObject({ status: "ended", expired: true });
    expect(state.activity).toBe("open");
    expect(state.responses).toBe(1);
  });

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
