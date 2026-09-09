import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, createRoom, joinAs, snapshotFor } from "./client";

/**
 * Presence, tested against the implementation that actually runs.
 *
 * It is computed in SQL from `last_seen_at` rather than tracked as state, so
 * these tests move that column directly — the only way to reach the behaviour
 * without waiting out the ninety-second window in real time.
 */
function db() {
  const url = process.env.CC_TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

async function ageLearner(code: string, seconds: number) {
  const sql = db();
  try {
    await sql`
      update participants set last_seen_at = now() - make_interval(secs => ${seconds})
      where room_id = (select id from rooms where code = ${code})`;
  } finally {
    await sql.end();
  }
}

interface Instructor {
  roster: { displayName: string; present: boolean }[];
  presentCount: number;
  joinedCount: number;
  pulse: { responded: number; total: number };
}

describe("presence", () => {
  it("counts a learner who has just been seen", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");

    const state = await snapshotFor<Instructor>(instructor, code, "instructor");
    expect(state.body.snapshot.presentCount).toBe(1);
    expect(state.body.snapshot.roster[0]?.present).toBe(true);
  });

  it("fades a learner to away once their heartbeat goes quiet, without losing them", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await learner.post(`/api/rooms/${code}/pulse`, { pulse: "got_it" });

    await ageLearner(code, 300);

    const state = await snapshotFor<Instructor>(instructor, code, "instructor");
    expect(state.body.snapshot.presentCount).toBe(0);
    // Still on the roster, marked away — a learner whose phone slept has not left.
    expect(state.body.snapshot.joinedCount).toBe(1);
    expect(state.body.snapshot.roster[0]?.present).toBe(false);
    // The live pulse follows presence, so a sleeping phone stops skewing it.
    expect(state.body.snapshot.pulse.total).toBe(0);
  });

  it("brings them straight back when their client speaks again", async () => {
    const { instructor, code } = await createRoom();
    const { learner } = await joinAs(code, "Ada");
    await ageLearner(code, 300);
    expect((await snapshotFor<Instructor>(instructor, code, "instructor")).body.snapshot
      .presentCount).toBe(0);

    // A learner reading their own state is a heartbeat.
    await learner.get(`/api/rooms/${code}/state?role=learner`);

    const state = await snapshotFor<Instructor>(instructor, code, "instructor");
    expect(state.body.snapshot.presentCount).toBe(1);
  });

  it("agrees between the instructor's roster and the shared screen's headcount", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");
    await joinAs(code, "Grace");
    await ageLearner(code, 300);
    const { learner: fresh } = await joinAs(code, "Alan");
    void fresh;

    const host = await snapshotFor<Instructor>(instructor, code, "instructor");
    const projector = await snapshotFor<{ presentCount: number }>(
      new Client("projector"),
      code,
      "public",
    );

    // Both are derived from the same column with the same window; if one were
    // computed against the application server's clock they would drift apart.
    expect(host.body.snapshot.presentCount).toBe(1);
    expect(projector.body.snapshot.presentCount).toBe(1);
  });

  it("leaves a learner who is away out of the participant picker", async () => {
    const { instructor, code } = await createRoom();
    await joinAs(code, "Ada");
    await ageLearner(code, 300);

    const result = await instructor.post(`/api/rooms/${code}/pick`);
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain("No learners");
  });
});
