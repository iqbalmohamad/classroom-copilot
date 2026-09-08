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
});
