import "server-only";
import { sql } from "./db";
import type { RoomRow } from "./auth";
import { summarisePulse } from "./domain/pulse";
import { tally, tallyVisibleTo } from "./domain/polls";
import { parsePollOptions } from "./domain/json";
import { isAiEnabled } from "./env";
import { PRESENCE_WINDOW_MS } from "./types";
import type {
  InstructorSnapshot,
  LearnerSnapshot,
  PickView,
  PollOption,
  PollView,
  PublicSnapshot,
  PulseValue,
  QuestionView,
  RoomHeader,
  RosterEntry,
} from "./types";

/**
 * Role-scoped snapshots.
 *
 * This module is the privacy boundary of the product. Each surface gets its own
 * builder and each builder starts from its own queries, so there is no shared
 * "full state" object that a learner or the projector could accidentally
 * receive a field of. Specifically:
 *
 *   instructor  roster with names and presence, aggregate distributions,
 *               who has answered the live poll (never *what* they answered),
 *               question author names only when the learner opted out of
 *               anonymity.
 *   learner     their own name, pulse and answer; the shared question list
 *               with no authorship; aggregates only once the instructor
 *               reveals them. No roster, no other learner's data.
 *   public      join details, the live question, a response *count*, aggregate
 *               results only once revealed, and the current pick's display
 *               name. No roster, no ids, no per-learner anything.
 *
 * Database ids for other people are never serialised to a learner or to the
 * projector; the only ids a client sees are for rows it is allowed to act on
 * (its own poll, its own questions).
 */

interface PollRow {
  id: string;
  seq: number;
  prompt: string;
  kind: PollView["kind"];
  options: PollOption[];
  status: PollView["status"];
  revealed: boolean;
  created_at: Date;
  opened_at: Date | null;
  closed_at: Date | null;
}

interface ParticipantRosterRow {
  id: string;
  display_name: string;
  pulse: PulseValue | null;
  joined_at: Date;
  /**
   * Computed by Postgres, not in Node. `last_seen_at` is written with the
   * database clock, so comparing it against the application server's clock made
   * the instructor's roster and the projector's headcount disagree whenever the
   * two drifted — and the projector already computed presence in SQL.
   */
  present: boolean;
}

function header(room: RoomRow): RoomHeader {
  return {
    code: room.code,
    title: room.title,
    status: room.status,
    publicMode: room.public_mode,
    createdAt: room.created_at.toISOString(),
    endedAt: room.ended_at ? room.ended_at.toISOString() : null,
  };
}

export function version(room: RoomRow): number {
  return Number(room.version);
}

export function joinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${code}`;
}

async function countsByValue(pollIds: string[]): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (pollIds.length === 0) return result;

  const rows = await sql<{ poll_id: string; value: string; n: string }[]>`
    select poll_id, value, count(*)::text as n
    from poll_responses
    where poll_id = any(${pollIds}::uuid[])
    group by poll_id, value`;

  for (const row of rows) {
    const bucket = result.get(row.poll_id) ?? {};
    bucket[row.value] = Number(row.n);
    result.set(row.poll_id, bucket);
  }
  return result;
}

function toPollView(
  row: PollRow,
  counts: Record<string, number>,
  role: "instructor" | "learner" | "public",
): PollView {
  const options = parsePollOptions(row.options);
  const tallies = tally(options, counts);
  const responseCount = tallies.reduce((sum, t) => sum + t.count, 0);
  return {
    id: row.id,
    seq: row.seq,
    prompt: row.prompt,
    kind: row.kind,
    options,
    status: row.status,
    revealed: row.revealed,
    responseCount,
    tallies: tallyVisibleTo(role, row.revealed) ? tallies : null,
    openedAt: row.opened_at ? row.opened_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

// ------------------------------------------------------------------ instructor

export async function instructorSnapshot(
  room: RoomRow,
  origin: string,
): Promise<InstructorSnapshot> {
  const [participants, polls, questionRows, pickRows, pickCountRows] = await Promise.all([
    sql<ParticipantRosterRow[]>`
      select id, display_name, pulse, joined_at,
             (last_seen_at > now() - make_interval(secs => ${PRESENCE_WINDOW_MS / 1000}))
               as present
      from participants where room_id = ${room.id}
      order by joined_at asc`,
    sql<PollRow[]>`
      select id, seq, prompt, kind, options, status, revealed, created_at, opened_at, closed_at
      from polls where room_id = ${room.id}
      order by seq desc`,
    sql<
      {
        id: string;
        body: string;
        status: QuestionView["status"];
        created_at: Date;
        votes: string;
        author_name: string | null;
      }[]
    >`
      select q.id, q.body, q.status, q.created_at,
             (select count(*) from question_votes v where v.question_id = q.id)::text as votes,
             case when q.is_anonymous then null else p.display_name end as author_name
      from questions q
      left join participants p on p.id = q.participant_id
      where q.room_id = ${room.id}
      order by q.created_at desc`,
    sql<{ id: string; display_name: string; created_at: Date }[]>`
      select id, display_name, created_at
      from picks where room_id = ${room.id}
      order by created_at desc
      limit 100`,
    // Counted separately, because the list above is capped for display: deriving
    // the per-learner totals from a truncated list would quietly understate the
    // fairness signal the instructor is reading.
    sql<{ participant_id: string; n: string }[]>`
      select participant_id, count(*)::text as n
      from picks
      where room_id = ${room.id} and participant_id is not null
      group by participant_id`,
  ]);

  const activePollRow = polls.find((p) => p.status === "open") ?? null;
  const counts = await countsByValue(polls.map((p) => p.id));

  const pickCounts = new Map<string, number>(
    pickCountRows.map((row) => [row.participant_id, Number(row.n)]),
  );

  const roster: RosterEntry[] = participants.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    present: p.present,
    joinedAt: p.joined_at.toISOString(),
    pickedCount: pickCounts.get(p.id) ?? 0,
  }));

  // The pulse aggregate is computed here, over present learners, and only the
  // aggregate leaves this function.
  const pulseOfPresent = participants.filter((p) => p.present).map((p) => p.pulse);

  const present = roster.filter((r) => r.present);

  return {
    role: "instructor",
    version: version(room),
    room: header(room),
    joinUrl: joinUrl(origin, room.code),
    roster,
    presentCount: present.length,
    joinedCount: roster.length,
    activePoll: activePollRow
      ? toPollView(activePollRow, counts.get(activePollRow.id) ?? {}, "instructor")
      : null,
    polls: polls.map((p) => toPollView(p, counts.get(p.id) ?? {}, "instructor")),
    pulse: summarisePulse(pulseOfPresent),
    questions: questionRows.map((q) => ({
      id: q.id,
      body: q.body,
      votes: Number(q.votes),
      status: q.status,
      createdAt: q.created_at.toISOString(),
      votedByMe: null,
      authorName: q.author_name,
    })),
    picks: pickRows.map<PickView>((p) => ({
      id: p.id,
      displayName: p.display_name,
      createdAt: p.created_at.toISOString(),
    })),
    aiEnabled: isAiEnabled(),
  };
}

// --------------------------------------------------------------------- learner

export async function learnerSnapshot(
  room: RoomRow,
  participantId: string,
): Promise<LearnerSnapshot> {
  const [meRows, pollRows, questionRows, lastPick] = await Promise.all([
    sql<{ display_name: string; pulse: PulseValue | null }[]>`
      select display_name, pulse from participants where id = ${participantId}`,
    sql<PollRow[]>`
      select id, seq, prompt, kind, options, status, revealed, created_at, opened_at, closed_at
      from polls
      where room_id = ${room.id} and status in ('open', 'closed')
      order by coalesce(opened_at, created_at) desc
      limit 1`,
    // One grouped pass rather than three correlated subqueries per row. This
    // runs for every learner on every version bump, so with forty phones and a
    // busy queue the correlated form was the most expensive query in the app.
    sql<
      {
        id: string;
        body: string;
        status: QuestionView["status"];
        created_at: Date;
        votes: string;
        voted: boolean;
      }[]
    >`
      select q.id, q.body, q.status, q.created_at,
             coalesce(v.total, 0)::text as votes,
             coalesce(v.mine, false) as voted
      from questions q
      left join (
        select question_id,
               count(*) as total,
               bool_or(participant_id = ${participantId}) as mine
        from question_votes
        where room_id = ${room.id}
        group by question_id
      ) v on v.question_id = q.id
      where q.room_id = ${room.id} and q.status <> 'hidden'
      order by coalesce(v.total, 0) desc, q.created_at desc
      limit 60`,
    sql<{ participant_id: string | null }[]>`
      select participant_id from picks where room_id = ${room.id}
      order by created_at desc limit 1`,
  ]);

  const me = meRows[0];
  const pollRow = pollRows[0] ?? null;
  const counts = pollRow ? await countsByValue([pollRow.id]) : new Map();

  const myAnswerRows = pollRow
    ? await sql<{ value: string }[]>`
        select value from poll_responses
        where poll_id = ${pollRow.id} and participant_id = ${participantId}`
    : [];

  return {
    role: "learner",
    version: version(room),
    room: header(room),
    me: { displayName: me?.display_name ?? "", pulse: me?.pulse ?? null },
    activePoll: pollRow ? toPollView(pollRow, counts.get(pollRow.id) ?? {}, "learner") : null,
    myAnswer: myAnswerRows[0]?.value ?? null,
    questions: questionRows.map((q) => ({
      id: q.id,
      body: q.body,
      votes: Number(q.votes),
      status: q.status,
      createdAt: q.created_at.toISOString(),
      votedByMe: q.voted,
    })),
    spotlight: (lastPick[0]?.participant_id ?? null) === participantId,
  };
}

// ---------------------------------------------------------------------- public

export async function publicSnapshot(room: RoomRow, origin: string): Promise<PublicSnapshot> {
  const presenceSeconds = PRESENCE_WINDOW_MS / 1000;

  const [presentRows, pollRows, pickRows] = await Promise.all([
    sql<{ n: string }[]>`
      select count(*)::text as n from participants
      where room_id = ${room.id}
        and last_seen_at > now() - make_interval(secs => ${presenceSeconds})`,
    sql<PollRow[]>`
      select id, seq, prompt, kind, options, status, revealed, created_at, opened_at, closed_at
      from polls
      where room_id = ${room.id} and status in ('open', 'closed')
      order by coalesce(opened_at, created_at) desc
      limit 1`,
    sql<{ display_name: string }[]>`
      select display_name from picks
      where room_id = ${room.id} order by created_at desc limit 1`,
  ]);

  const pollRow = pollRows[0] ?? null;
  const counts = pollRow ? await countsByValue([pollRow.id]) : new Map();

  // The projector shows a learner's name only while the instructor has it on
  // the pick screen, so the payload only carries it then. Hiding it in the
  // component would not be enough: /state?role=public needs no credential of
  // any kind, and anyone with the room code can read whatever it returns.
  const pick = room.public_mode === "pick" && room.status === "open" ? pickRows[0] : undefined;

  return {
    role: "public",
    version: version(room),
    room: header(room),
    joinUrl: joinUrl(origin, room.code),
    presentCount: Number(presentRows[0]?.n ?? 0),
    activePoll: pollRow ? toPollView(pollRow, counts.get(pollRow.id) ?? {}, "public") : null,
    lastPick: pick ? { displayName: pick.display_name } : null,
  };
}
