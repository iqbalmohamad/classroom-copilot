/**
 * Pre- and post-migration check for the 0003 pulse cutover.
 *
 * 0003 copies `participants.pulse` into `pulse_responses` and the new
 * application stops writing that column. The old application is still writing
 * it right up until the new build is live, so any pulse a learner sets between
 * the backfill and the deploy lands somewhere the new code will never read.
 *
 * There is no way to make those two writers agree, so the migration is run in a
 * window with no class in it. This script is how that is established rather
 * than assumed, and how it is confirmed afterwards.
 *
 *   npx tsx scripts/cutover-check.ts          # before migrating
 *   npx tsx scripts/cutover-check.ts --after  # after deploying
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/** A room is "in use" if anyone has been seen in it recently. */
const ACTIVE_WINDOW_MINUTES = 20;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const after = process.argv.includes("--after");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  let blocking = 0;

  try {
    const active = await sql<{ code: string; title: string; learners: string; last: Date }[]>`
      select r.code, r.title, count(p.id)::text as learners, max(p.last_seen_at) as last
      from rooms r
      join participants p on p.room_id = r.id
      where r.status = 'open'
        and p.last_seen_at > now() - make_interval(mins => ${ACTIVE_WINDOW_MINUTES})
      group by r.code, r.title
      order by last desc`;

    if (active.length === 0) {
      console.log(`No class has been active in the last ${ACTIVE_WINDOW_MINUTES} minutes.`);
    } else {
      blocking += 1;
      console.log(`${active.length} class(es) still in use — do not migrate yet:`);
      for (const room of active) {
        console.log(`  ${room.code}  ${room.title}  ${room.learners} learner(s), last seen ${room.last.toISOString()}`);
      }
    }

    const migrated = await sql<{ applied_at: Date }[]>`
      select applied_at from schema_migrations where name = '0003_classroom_workflow.sql'`;

    if (!migrated[0]) {
      console.log("0003 has not been applied yet.");
    } else {
      console.log(`0003 applied at ${migrated[0].applied_at.toISOString()}.`);

      // The loss this whole procedure exists to prevent: a pulse written by the
      // old application after the backfill copied the column across.
      const stranded = await sql<{ code: string; n: string }[]>`
        select r.code, count(*)::text as n
        from participants p
        join rooms r on r.id = p.room_id
        where p.pulse is not null
          and p.pulse_at > ${migrated[0].applied_at}
        group by r.code`;

      if (stranded.length === 0) {
        console.log("No pulse was written to the old column after the migration. Nothing lost.");
      } else {
        blocking += 1;
        console.log("Pulse written to the deprecated column AFTER the migration:");
        for (const row of stranded) {
          console.log(`  ${row.code}: ${row.n} learner(s) — these are not in pulse_responses.`);
        }
        console.log(
          "\nThe old application was still serving traffic. Those learners can simply tap\n" +
            "again on the new build; there is no automatic reconciliation, because guessing\n" +
            "which round a stale value belonged to would put answers in the wrong section.",
        );
      }
    }

    if (after) {
      const rounds = await sql<{ n: string }[]>`select count(*)::text as n from pulse_rounds`;
      const responses = await sql<{ n: string }[]>`select count(*)::text as n from pulse_responses`;
      console.log(
        `\nNew source of truth: ${rounds[0]!.n} round(s), ${responses[0]!.n} response(s).`,
      );
    }
  } finally {
    await sql.end();
  }

  console.log(blocking === 0 ? "\nSafe to proceed." : "\nNot safe to proceed yet.");
  process.exit(blocking === 0 ? 0 : 1);
}

void main();
