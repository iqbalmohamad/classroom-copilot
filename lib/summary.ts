import "server-only";
import { sql } from "./db";
import type { RoomRow } from "./auth";
import { tally } from "./domain/polls";
import { parsePollOptions } from "./domain/json";
import { summarisePulse } from "./domain/pulse";
import { parseAnswers, parseFields, type ActivityField } from "./domain/activities";
import {
  PRESENCE_WINDOW_MS,
  type ActivityStatus,
  type PollKind,
  type PollOption,
  type PollTally,
  type PulseSummary,
  type PulseValue,
  type ReviewState,
} from "./types";

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
  /** Where it was asked, as captured at submission time. */
  sectionTitle: string | null;
  activityTitle: string | null;
  /** Still open at the end of the session. */
  unresolved: boolean;
}

export interface SectionSummary {
  id: string;
  position: number;
  title: string;
}

/** One pulse round. Counts only — never who chose what, here or anywhere. */
export interface PulseRoundSummary {
  seq: number;
  label: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  openedAt: string;
  closedAt: string | null;
  summary: PulseSummary;
}

export interface ActivityResponseSummary {
  displayName: string;
  answers: Record<string, string>;
  reviewState: ReviewState;
  feedback: string | null;
  updatedAt: string;
}

export interface ActivitySummary {
  id: string;
  seq: number;
  sectionId: string | null;
  sectionTitle: string | null;
  title: string;
  instructions: string | null;
  fields: ActivityField[];
  status: ActivityStatus;
  attempt: number;
  responseCount: number;
  responseRate: number;
  reviewCounts: Record<ReviewState, number>;
  referenceAnswer: string | null;
  /** Named submissions. This whole structure is built only for the instructor. */
  responses: ActivityResponseSummary[];
  openedAt: string | null;
  closedAt: string | null;
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
  sections: SectionSummary[];
  /** Every round, oldest first, so before-and-after reads in order. */
  pulseRounds: PulseRoundSummary[];
  activities: ActivitySummary[];
  activitySubmissions: number;
  materials: { title: string; url: string; note: string | null; sectionTitle: string | null }[];
}

/**
 * The whole session, for the instructor.
 *
 * Named submissions and private feedback are in here, which is why the only
 * route that builds it requires the host token — a room code opens nothing.
 * Pulse stays aggregate even at this level: the queries below group before they
 * return, so there is no point at which a name sits next to a pulse value.
 */
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
        section_id: string | null;
        activity_id: string | null;
      }[]
    >`select q.body, q.status, q.created_at, q.section_id, q.activity_id,
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
        select participant_id from pulse_responses where room_id = ${room.id}
        union
        select participant_id from activity_responses where room_id = ${room.id}
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

  const [sectionRows, roundRows, roundCounts, activityRows, submissionRows, materialRows] =
    await Promise.all([
      sql<{ id: string; position: number; title: string }[]>`
        select id, position, title from sections where room_id = ${room.id} order by position asc`,
      sql<
        {
          id: string;
          seq: number;
          label: string | null;
          section_id: string | null;
          opened_at: Date;
          closed_at: Date | null;
        }[]
      >`
        select id, seq, label, section_id, opened_at, closed_at
        from pulse_rounds where room_id = ${room.id} order by seq asc`,
      sql<{ round_id: string; value: PulseValue; n: string }[]>`
        select round_id, value, count(*)::text as n
        from pulse_responses where room_id = ${room.id}
        group by round_id, value`,
      sql<
        {
          id: string;
          seq: number;
          section_id: string | null;
          title: string;
          instructions: string | null;
          fields: unknown;
          status: ActivityStatus;
          attempt: number;
          reference_answer: string | null;
          opened_at: Date | null;
          closed_at: Date | null;
        }[]
      >`
        select id, seq, section_id, title, instructions, fields, status, attempt,
               reference_answer, opened_at, closed_at
        from activities where room_id = ${room.id} order by seq asc`,
      sql<
        {
          activity_id: string;
          display_name: string | null;
          answers: unknown;
          review_state: ReviewState;
          feedback: string | null;
          updated_at: Date;
        }[]
      >`
        select r.activity_id, p.display_name, r.answers, r.review_state, r.feedback, r.updated_at
        from activity_responses r
        left join participants p on p.id = r.participant_id
        where r.room_id = ${room.id}
        order by r.created_at asc`,
      sql<{ title: string; url: string; note: string | null; section_id: string | null }[]>`
        select title, url, note, section_id from materials
        where room_id = ${room.id} order by position asc`,
    ]);

  const sectionTitle = (id: string | null) =>
    sectionRows.find((section) => section.id === id)?.title ?? null;

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

  type SubmissionRow = (typeof submissionRows)[number];
  const answersByActivity = new Map<string, SubmissionRow[]>();
  for (const row of submissionRows) {
    const bucket = answersByActivity.get(row.activity_id) ?? [];
    bucket.push(row);
    answersByActivity.set(row.activity_id, bucket);
  }

  const activities: ActivitySummary[] = activityRows.map((row) => {
    const rows: SubmissionRow[] = answersByActivity.get(row.id) ?? [];
    const reviewCounts: Record<ReviewState, number> = {
      pending: 0,
      reviewed: 0,
      needs_follow_up: 0,
    };
    for (const response of rows) reviewCounts[response.review_state] += 1;

    return {
      id: row.id,
      seq: row.seq,
      sectionId: row.section_id,
      sectionTitle: sectionTitle(row.section_id),
      title: row.title,
      instructions: row.instructions,
      fields: parseFields(row.fields),
      status: row.status,
      attempt: row.attempt,
      responseCount: rows.length,
      responseRate: learnersJoined === 0 ? 0 : Math.round((rows.length / learnersJoined) * 100),
      reviewCounts,
      referenceAnswer: row.reference_answer,
      responses: rows.map((response) => ({
        displayName: response.display_name ?? "Someone who has left",
        answers: parseAnswers(response.answers),
        reviewState: response.review_state,
        feedback: response.feedback,
        updatedAt: response.updated_at.toISOString(),
      })),
      openedAt: row.opened_at ? row.opened_at.toISOString() : null,
      closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    };
  });

  const pulseByRound = new Map<string, PulseValue[]>();
  for (const row of roundCounts) {
    const bucket = pulseByRound.get(row.round_id) ?? [];
    for (let i = 0; i < Number(row.n); i += 1) bucket.push(row.value);
    pulseByRound.set(row.round_id, bucket);
  }

  const pulseRounds: PulseRoundSummary[] = roundRows.map((round) => {
    const answers = pulseByRound.get(round.id) ?? [];
    const padded: (PulseValue | null)[] = [
      ...answers,
      ...Array<null>(Math.max(0, learnersJoined - answers.length)).fill(null),
    ];
    return {
      seq: round.seq,
      label: round.label,
      sectionId: round.section_id,
      sectionTitle: sectionTitle(round.section_id),
      openedAt: round.opened_at.toISOString(),
      closedAt: round.closed_at ? round.closed_at.toISOString() : null,
      summary: summarisePulse(padded),
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
    // The live readout follows presence; the summary reports the last round in
    // full, so a post-class read is not skewed by who has closed their laptop.
    pulse:
      pulseRounds[pulseRounds.length - 1]?.summary ??
      summarisePulse(Array(learnersJoined).fill(null)),
    pulseUpdates: Number(pulseUpdateRows[0]?.n ?? 0),
    questions: questionRows.map((q) => ({
      body: q.body,
      votes: Number(q.votes),
      status: q.status,
      authorName: q.author_name,
      createdAt: q.created_at.toISOString(),
      sectionTitle: sectionTitle(q.section_id),
      activityTitle: activities.find((a) => a.id === q.activity_id)?.title ?? null,
      unresolved: q.status === "open",
    })),
    questionUpvotes: Number(voteCountRows[0]?.n ?? 0),
    picks: pickRows.map((p) => ({
      displayName: p.display_name,
      createdAt: p.created_at.toISOString(),
    })),
    interactionsRun: polls.length + pickRows.length + activities.length,
    sections: sectionRows.map((section) => ({
      id: section.id,
      position: section.position,
      title: section.title,
    })),
    pulseRounds,
    activities,
    activitySubmissions: submissionRows.length,
    materials: materialRows.map((material) => ({
      title: material.title,
      url: material.url,
      note: material.note,
      sectionTitle: sectionTitle(material.section_id),
    })),
  };
}
