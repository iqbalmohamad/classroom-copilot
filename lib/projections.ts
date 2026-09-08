import "server-only";
import { sql } from "./db";
import type { RoomRow } from "./auth";
import { isPresent } from "./domain/presence";
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
  last_seen_at: Date;
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
  const now = new Date();

  const [participants, polls, questionRows, pickRows] = await Promise.all([
    sql<ParticipantRosterRow[]>`
      select id, display_name, pulse, joined_at, last_seen_at
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
    sql<{ id: string; display_name: string; created_at: Date; participant_id: string | null }[]>`
      select id, display_name, created_at, participant_id
      from picks where room_id = ${room.id}
      order by created_at desc
      limit 100`,
  ]);

  const activePollRow = polls.find((p) => p.status === "open") ?? null;
  const counts = await countsByValue(polls.map((p) => p.id));

  const answered = activePollRow
    ? new Set(
        (
          await sql<{ participant_id: string }[]>`
            select participant_id from poll_responses where poll_id = ${activePollRow.id}`
        ).map((r) => r.participant_id),
      )
    : new Set<string>();

  const pickCounts = new Map<string, number>();
  for (const pick of pickRows) {
    if (!pick.participant_id) continue;
    pickCounts.set(pick.participant_id, (pickCounts.get(pick.participant_id) ?? 0) + 1);
  }

  const roster: RosterEntry[] = participants.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    present: isPresent(p.last_seen_at, now),
    joinedAt: p.joined_at.toISOString(),
    pulse: p.pulse,
    answeredActivePoll: answered.has(p.id),
    pickedCount: pickCounts.get(p.id) ?? 0,
  }));

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
    pulse: summarisePulse(present.map((p) => p.pulse)),
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
             (select count(*) from question_votes v where v.question_id = q.id)::text as votes,
             exists (
               select 1 from question_votes v
               where v.question_id = q.id and v.participant_id = ${participantId}
             ) as voted
      from questions q
      where q.room_id = ${room.id} and q.status <> 'hidden'
      order by (select count(*) from question_votes v where v.question_id = q.id) desc,
               q.created_at desc
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
    sql<{ id: string; display_name: string; created_at: Date }[]>`
      select id, display_name, created_at from picks
      where room_id = ${room.id} order by created_at desc limit 1`,
  ]);

  const pollRow = pollRows[0] ?? null;
  const counts = pollRow ? await countsByValue([pollRow.id]) : new Map();
  const pick = pickRows[0];

  return {
    role: "public",
    version: version(room),
    room: header(room),
    joinUrl: joinUrl(origin, room.code),
    presentCount: Number(presentRows[0]?.n ?? 0),
    activePoll: pollRow ? toPollView(pollRow, counts.get(pollRow.id) ?? {}, "public") : null,
    lastPick: pick
      ? { id: pick.id, displayName: pick.display_name, createdAt: pick.created_at.toISOString() }
      : null,
  };
}
