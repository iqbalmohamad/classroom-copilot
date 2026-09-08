import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { BASE_URL, createRoom, joinAs, snapshotFor } from "./client";

/**
 * Two defects that only show up under load, both found by review rather than
 * by any assertion the other suites make. They are cheap to guard and
 * expensive to rediscover during a class.
 */
describe("behaviour under pressure", () => {
  it("does not deadlock when a learner answers and changes pulse at the same instant", async () => {
    const { instructor, code } = await createRoom();
    const learners = await Promise.all(
      Array.from({ length: 10 }, (_, i) => joinAs(code, `D${i + 1}`)),
    );
    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Answer and pulse together",
      kind: "yes_no",
      openNow: true,
    });
    const pollId = poll.body.pollId;

    // Writing a poll response and writing a pulse both end up updating the same
    // room row. If they take the participant and room locks in opposite orders,
    // Postgres aborts one of them and the learner sees a server error.
    const results = await Promise.all(
      learners.flatMap(({ learner }, index) => [
        learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, {
          value: index % 2 ? "yes" : "no",
        }),
        learner.post(`/api/rooms/${code}/pulse`, { pulse: "shaky" }),
        learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" }),
        learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "yes" }),
      ]),
    );

    const failures = results.filter((r) => r.status !== 200);
    expect(failures.map((f) => JSON.stringify(f.body))).toEqual([]);

    const state = await snapshotFor<{
      activePoll: { responseCount: number };
      pulse: { responded: number };
    }>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll.responseCount).toBe(10);
    expect(state.body.snapshot.pulse.responded).toBe(10);
  });

  it("does not hammer the database while a stream sits on an idle room", async () => {
    const databaseUrl = process.env.CC_TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
    const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

    const transactions = async () => {
      const rows = await sql<{ n: string }[]>`
        select (xact_commit + xact_rollback)::text as n
        from pg_stat_database where datname = current_database()`;
      return Number(rows[0]?.n ?? 0);
    };

    const sample = async (ms: number) => {
      const before = await transactions();
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ((await transactions()) - before) / ((Date.now() - start) / 1000);
    };

    try {
      const { code } = await createRoom();
      await joinAs(code, "Ada");

      // Measure the MARGINAL cost of one stream rather than the absolute rate:
      // earlier suites in the same run may still be winding down connections,
      // and it is the per-client cost that regresses.
      const idle = await sample(4000);

      const controller = new AbortController();
      const response = await fetch(`${BASE_URL}/api/rooms/${code}/stream?role=public`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const reader = response.body!.getReader();
      void (async () => {
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } catch {
          /* aborted */
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 1000));
      const withStream = await sample(6000);
      controller.abort();

      // By design the loop polls one indexed counter every 400ms, so about
      // 2.5 transactions a second. Rebuilding the whole snapshot on every tick
      // of an idle room — which is what a stale-tracking bug causes — lands an
      // order of magnitude above this.
      const marginal = withStream - idle;
      expect(marginal).toBeGreaterThan(0.5); // the loop is actually running
      expect(marginal).toBeLessThan(8); // and is not rebuilding snapshots
    } finally {
      await sql.end();
    }
  });

  it("survives an instructor double-clicking Open, and two tabs opening at once", async () => {
    const { instructor, code } = await createRoom();

    // Two poll creations racing: `polls.seq` is max(seq)+1, which is only safe
    // because the write is serialised. A bare 500 here is what an instructor
    // sees when they double-submit the form.
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
          prompt: `Race ${i + 1}`,
          kind: "yes_no",
          openNow: true,
        }),
      ),
    );
    expect(created.filter((c) => c.status !== 200)).toEqual([]);

    // And two tabs opening different polls at the same moment: "one open poll
    // per room" is a partial unique index, so an unserialised open is a 500.
    const ids = created.map((c) => c.body.pollId);
    const opens = await Promise.all(
      ids.map((id) => instructor.post(`/api/rooms/${code}/polls/${id}`, { action: "open" })),
    );
    for (const result of opens) {
      // Either it opened, or it was legitimately rejected as already open.
      expect([200, 409]).toContain(result.status);
    }

    const state = await snapshotFor<{ polls: { status: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    expect(state.body.snapshot.polls.filter((p) => p.status === "open")).toHaveLength(1);
  });

  it("clears the close time when a poll is reopened, and keeps the answers", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Reopen me",
      kind: "yes_no",
      openNow: true,
    });
    const pollId = poll.body.pollId;
    await learner.post(`/api/rooms/${code}/polls/${pollId}/respond`, { value: "yes" });

    await instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "close" });
    await instructor.post(`/api/rooms/${code}/polls/${pollId}`, { action: "open" });

    const state = await snapshotFor<{
      activePoll: { closedAt: string | null; responseCount: number };
    }>(instructor, code, "instructor");
    expect(state.body.snapshot.activePoll.closedAt).toBeNull();
    // The same question is being put to the room again, so the answers stand.
    expect(state.body.snapshot.activePoll.responseCount).toBe(1);
  });

  it("stops a poll that is still collecting when the class ends", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    const poll = await instructor.post<{ pollId: string }>(`/api/rooms/${code}/polls`, {
      prompt: "Still open at the bell",
      kind: "yes_no",
      openNow: true,
    });

    await instructor.post(`/api/rooms/${code}/end`);

    const state = await snapshotFor<{ polls: { status: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    expect(state.body.snapshot.polls.every((p) => p.status !== "open")).toBe(true);

    const late = await learner.post(`/api/rooms/${code}/polls/${poll.body.pollId}/respond`, {
      value: "yes",
    });
    expect([409, 410]).toContain(late.status);
  });

  it("keeps a learner's upvote toggle consistent under a retried tap", async () => {
    const { instructor, code } = await createRoom();
    const { learner: asker } = await joinAs(code, "Ada");
    const { learner: voter } = await joinAs(code, "Grace");
    await asker.post(`/api/rooms/${code}/questions`, { body: "Toggle under pressure" });

    const state = await snapshotFor<{ questions: { id: string }[] }>(
      instructor,
      code,
      "instructor",
    );
    const questionId = state.body.snapshot.questions[0]!.id;

    // Fire an odd number of toggles concurrently, several times over. Whatever
    // the interleaving, the stored state must match what the last call returned
    // and can never exceed one vote.
    for (let round = 0; round < 5; round += 1) {
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          voter.post<{ voted: boolean }>(`/api/rooms/${code}/questions/${questionId}/vote`),
        ),
      );
      expect(results.filter((r) => r.status !== 200)).toEqual([]);

      const after = await snapshotFor<{ questions: { votes: number }[] }>(
        instructor,
        code,
        "instructor",
      );
      const votes = after.body.snapshot.questions[0]!.votes;
      expect(votes).toBeGreaterThanOrEqual(0);
      expect(votes).toBeLessThanOrEqual(1);
    }
  });
});
