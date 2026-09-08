import "server-only";
import { sql } from "./db";
import type { RoomRow } from "./auth";
import { tally } from "./domain/polls";
import { parsePollOptions } from "./domain/json";
import { summarisePulse } from "./domain/pulse";
import { PRESENCE_WINDOW_MS, type PollKind, type PollOption, type PollTally, type PulseSummary, type PulseValue } from "./types";

/**
 * Basic session summary (PRD s13).
 *
 * Deliberately a plain readout rather than an analytics product: counts the
 * instructor can act on straight after class, and nothing that would require a
 * charting or warehousing layer to maintain.
 */

export interface PollSummary {
  seq: number;
  prompt: string;
  kind: PollKind;
  status: string;
  responseCount: number;
  responseRate: number;
  tallies: PollTally[];
  openedAt: string | null;
  closedAt: string | null;
}

export interface QuestionSummary {
  body: string;
  votes: number;
  status: string;
  authorName: string | null;
  createdAt: string;
}

export interface SessionSummary {
  room: { code: string; title: string; status: string };
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  learnersJoined: number;
  learnersPresent: number;
  /** Learners who did at least one thing: answered, pulsed, asked, or upvoted. */
  learnersParticipating: number;
  participationRate: number;
  polls: PollSummary[];
  pollsAsked: number;
  totalResponses: number;
  pulse: PulseSummary;
  pulseUpdates: number;
  questions: QuestionSummary[];
  questionUpvotes: number;
  picks: { displayName: string; createdAt: string }[];
  interactionsRun: number;
}

export async function buildSummary(room: RoomRow): Promise<SessionSummary> {
  const seconds = PRESENCE_WINDOW_MS / 1000;

  const [
    participants,
    pollRows,
    responseRows,
    questionRows,
    pickRows,
    participatingRows,
    voteCountRows,
    pulseUpdateRows,
  ] = await Promise.all([
    sql<{ pulse: PulseValue | null; present: boolean }[]>`
      select pulse, (last_seen_at > now() - make_interval(secs => ${seconds})) as present
      from participants where room_id = ${room.id}`,
    sql<
      {
        id: string;
        seq: number;
        prompt: string;
        kind: PollKind;
        options: PollOption[];
        status: string;
        opened_at: Date | null;
        closed_at: Date | null;
      }[]
    >`select id, seq, prompt, kind, options, status, opened_at, closed_at
      from polls where room_id = ${room.id} order by seq asc`,
    sql<{ poll_id: string; value: string; n: string }[]>`
      select poll_id, value, count(*)::text as n
      from poll_responses where room_id = ${room.id}
      group by poll_id, value`,
    sql<
      {
        body: string;
        status: string;
        created_at: Date;
        votes: string;
        author_name: string | null;
      }[]
    >`select q.body, q.status, q.created_at,
             (select count(*) from question_votes v where v.question_id = q.id)::text as votes,
             case when q.is_anonymous then null else p.display_name end as author_name
      from questions q
      left join participants p on p.id = q.participant_id
      where q.room_id = ${room.id}
      order by q.created_at asc`,
    sql<{ display_name: string; created_at: Date }[]>`
      select display_name, created_at from picks
      where room_id = ${room.id} order by created_at asc`,
    sql<{ n: string }[]>`
      select count(distinct pid)::text as n from (
        select participant_id as pid from poll_responses where room_id = ${room.id}
        union
        select id from participants where room_id = ${room.id} and pulse is not null
        union
        select participant_id from questions
          where room_id = ${room.id} and participant_id is not null
        union
        select participant_id from question_votes where room_id = ${room.id}
      ) as interactions`,
    sql<{ n: string }[]>`
      select count(*)::text as n from question_votes where room_id = ${room.id}`,
    sql<{ n: string }[]>`
      select count(*)::text as n from session_events
      where room_id = ${room.id} and kind = 'pulse_set'`,
  ]);

  const countsByPoll = new Map<string, Record<string, number>>();
  for (const row of responseRows) {
    const bucket = countsByPoll.get(row.poll_id) ?? {};
    bucket[row.value] = Number(row.n);
    countsByPoll.set(row.poll_id, bucket);
  }

  const learnersJoined = participants.length;
  const present = participants.filter((p) => p.present);

  const polls: PollSummary[] = pollRows.map((row) => {
    const tallies = tally(parsePollOptions(row.options), countsByPoll.get(row.id) ?? {});
    const responseCount = tallies.reduce((sum, t) => sum + t.count, 0);
    return {
      seq: row.seq,
      prompt: row.prompt,
      kind: row.kind,
      status: row.status,
      responseCount,
      responseRate: learnersJoined === 0 ? 0 : Math.round((responseCount / learnersJoined) * 100),
      tallies,
      openedAt: row.opened_at ? row.opened_at.toISOString() : null,
      closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    };
  });

  const startedAt = room.created_at;
  const endedAt = room.ended_at;
  const durationMs = (endedAt ?? new Date()).getTime() - startedAt.getTime();
  const participating = Number(participatingRows[0]?.n ?? 0);
  const totalResponses = polls.reduce((sum, p) => sum + p.responseCount, 0);

  return {
    room: { code: room.code, title: room.title, status: room.status },
    startedAt: startedAt.toISOString(),
    endedAt: endedAt ? endedAt.toISOString() : null,
    durationMinutes: Math.max(0, Math.round(durationMs / 60_000)),
    learnersJoined,
    learnersPresent: present.length,
    learnersParticipating: participating,
    participationRate:
      learnersJoined === 0 ? 0 : Math.round((participating / learnersJoined) * 100),
    polls,
    pollsAsked: polls.length,
    totalResponses,
    // The live pulse readout follows presence; the summary reports every learner
    // who registered one, so a post-class read is not skewed by who has closed
    // their laptop.
    pulse: summarisePulse(participants.map((p) => p.pulse)),
    pulseUpdates: Number(pulseUpdateRows[0]?.n ?? 0),
    questions: questionRows.map((q) => ({
      body: q.body,
      votes: Number(q.votes),
      status: q.status,
      authorName: q.author_name,
      createdAt: q.created_at.toISOString(),
    })),
    questionUpvotes: Number(voteCountRows[0]?.n ?? 0),
    picks: pickRows.map((p) => ({
      displayName: p.display_name,
      createdAt: p.created_at.toISOString(),
    })),
    interactionsRun: polls.length + pickRows.length,
  };
}
