import "server-only";
import { sql } from "./db";
import type { RoomRow } from "./auth";
import { summarisePulse } from "./domain/pulse";
import { tally, tallyVisibleTo } from "./domain/polls";
import { parseAnswers, parseFields } from "./domain/activities";
import { parsePollOptions } from "./domain/json";
import { isAiEnabled } from "./env";
import { PRESENCE_WINDOW_MS } from "./types";
import type {
  ActivityResponseView,
  ActivityStatus,
  ActivityView,
  InstructorSnapshot,
  LearnerSnapshot,
  MaterialView,
  MySubmission,
  PickView,
  PollOption,
  PollView,
  PublicSnapshot,
  PulseRoundView,
  PulseValue,
  QuestionView,
  RevealedResponseView,
  ReviewState,
  RoomHeader,
  RosterEntry,
  SectionView,
  TimerView,
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
 * The workflow additions keep the same shape. In particular:
 *
 *   * pulse is aggregate at every level, including in history — no projection
 *     here selects pulse_responses.value alongside a participant id;
 *   * an activity's own definition is public, but nobody's answer is: a learner
 *     receives only their own submission, and the projector receives one
 *     response only when the instructor has deliberately revealed it, without
 *     the author's name unless they also asked for that;
 *   * instructor feedback is read back by exactly two parties — the instructor,
 *     and the learner it was written for;
 *   * an activity's reference answer is instructor-only and is never selected
 *     into a learner or public payload.
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

function header(room: RoomRow, sections: SectionView[]): RoomHeader {
  const current = sections.find((section) => section.id === room.current_section_id) ?? null;
  return {
    code: room.code,
    title: room.title,
    status: room.status,
    publicMode: room.public_mode,
    createdAt: room.created_at.toISOString(),
    endedAt: room.ended_at ? room.ended_at.toISOString() : null,
    currentSectionId: current?.id ?? null,
    currentSectionTitle: current?.title ?? null,
    pulseEpoch: room.pulse_epoch,
  };
}

// ------------------------------------------------------- shared building blocks

interface ActivityRow {
  id: string;
  seq: number;
  section_id: string | null;
  title: string;
  instructions: string | null;
  fields: unknown;
  status: ActivityStatus;
  attempt: number;
  duration_seconds: number | null;
  reference_answer: string | null;
  created_at: Date;
  opened_at: Date | null;
  closed_at: Date | null;
}

interface TimerRow {
  id: string;
  label: string;
  status: TimerView["status"];
  duration_seconds: number;
  ends_at: Date | null;
  remaining_seconds: number | null;
  auto_close: boolean;
  expired: boolean;
  activity_id: string | null;
}

export async function roomSections(roomId: string): Promise<SectionView[]> {
  const rows = await sql<{ id: string; position: number; title: string }[]>`
    select id, position, title from sections where room_id = ${roomId} order by position asc`;
  return rows.map((row) => ({ id: row.id, position: row.position, title: row.title }));
}

/**
 * The clock every surface counts down from.
 *
 * A timer that has already run out is not returned as "running": expiry is
 * applied before snapshots are built, so what is stored is what the class sees.
 */
async function roomTimer(roomId: string): Promise<TimerView | null> {
  const rows = await sql<TimerRow[]>`
    select id, label, status, duration_seconds, ends_at, remaining_seconds, auto_close,
           expired, activity_id
    from timers where room_id = ${roomId} and status <> 'ended'
    order by created_at desc limit 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    durationSeconds: row.duration_seconds,
    endsAt: row.ends_at ? row.ends_at.toISOString() : null,
    remainingSeconds: row.remaining_seconds,
    autoClose: row.auto_close,
    expired: row.expired,
    activityId: row.activity_id,
  };
}

async function roomMaterials(roomId: string, sections: SectionView[]): Promise<MaterialView[]> {
  const rows = await sql<
    {
      id: string;
      section_id: string | null;
      title: string;
      url: string;
      note: string | null;
      highlighted: boolean;
    }[]
  >`
    select id, section_id, title, url, note, highlighted
    from materials where room_id = ${roomId} order by highlighted desc, position asc`;
  return rows.map((row) => ({
    id: row.id,
    sectionId: row.section_id,
    sectionTitle: sections.find((section) => section.id === row.section_id)?.title ?? null,
    title: row.title,
    url: row.url,
    note: row.note,
    highlighted: row.highlighted,
  }));
}

async function activityResponseCounts(
  roomId: string,
): Promise<Map<string, { total: number; review: Record<ReviewState, number> }>> {
  const rows = await sql<{ activity_id: string; review_state: ReviewState; n: string }[]>`
    select activity_id, review_state, count(*)::text as n
    from activity_responses where room_id = ${roomId}
    group by activity_id, review_state`;

  const result = new Map<string, { total: number; review: Record<ReviewState, number> }>();
  for (const row of rows) {
    const bucket =
      result.get(row.activity_id) ??
      { total: 0, review: { pending: 0, reviewed: 0, needs_follow_up: 0 } };
    bucket.total += Number(row.n);
    bucket.review[row.review_state] += Number(row.n);
    result.set(row.activity_id, bucket);
  }
  return result;
}

function toActivityView(
  row: ActivityRow,
  counts: { total: number; review: Record<ReviewState, number> } | undefined,
  role: "instructor" | "learner" | "public",
): ActivityView {
  const view: ActivityView = {
    id: row.id,
    seq: row.seq,
    sectionId: row.section_id,
    title: row.title,
    instructions: row.instructions,
    fields: parseFields(row.fields),
    status: row.status,
    attempt: row.attempt,
    durationSeconds: row.duration_seconds,
    responseCount: counts?.total ?? 0,
    openedAt: row.opened_at ? row.opened_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
  // The instructor's own answer and the size of the marking pile are theirs
  // alone; the two extra keys simply do not exist on the other surfaces.
  if (role === "instructor") {
    view.referenceAnswer = row.reference_answer;
    view.reviewCounts = counts?.review ?? { pending: 0, reviewed: 0, needs_follow_up: 0 };
  }
  return view;
}

/**
 * The activity column list, as a function rather than a constant.
 *
 * A `sql\`...\`` fragment evaluated at module scope calls the connection proxy
 * during import, which on Workers happens outside any request — and the proxy
 * refuses, correctly, because a connection there belongs to the request that
 * opened it. The whole server module then fails to instantiate and every route
 * returns 500. Node never notices, because its pool is process-wide; only the
 * workerd run catches it.
 */
const activityColumns = () => sql`
  id, seq, section_id, title, instructions, fields, status, attempt, duration_seconds,
  reference_answer, created_at, opened_at, closed_at`;

interface PulseDenominators {
  /** Learners in the room right now: the denominator for the live round. */
  present: number;
  /** Everyone who joined: the denominator for a round that has closed. */
  joined: number;
}

/**
 * One round's counts.
 *
 * Built from a grouped query, so no row carrying both a participant and their
 * choice is ever materialised in this process, let alone serialised.
 *
 * The live round counts only learners who are still in the room, which is what
 * keeps a sleeping phone from dragging the readout down mid-explanation. A
 * closed round counts everyone who answered it, because that is the record of
 * what the class said at the time — and the two denominators differ for the
 * same reason.
 */
async function pulseRoundViews(
  roomId: string,
  sections: SectionView[],
  denominators: PulseDenominators,
): Promise<PulseRoundView[]> {
  const presenceSeconds = PRESENCE_WINDOW_MS / 1000;
  const [rounds, counts] = await Promise.all([
    sql<
      {
        id: string;
        seq: number;
        label: string | null;
        section_id: string | null;
        status: "open" | "closed";
        opened_at: Date;
        closed_at: Date | null;
      }[]
    >`
      select id, seq, label, section_id, status, opened_at, closed_at
      from pulse_rounds where room_id = ${roomId} order by seq desc limit 40`,
    sql<{ round_id: string; value: PulseValue; all_n: string; present_n: string }[]>`
      select r.round_id, r.value,
             count(*)::text as all_n,
             count(*) filter (
               where p.last_seen_at > now() - make_interval(secs => ${presenceSeconds})
             )::text as present_n
      from pulse_responses r
      join participants p on p.id = r.participant_id
      where r.room_id = ${roomId}
      group by r.round_id, r.value`,
  ]);

  return rounds.map((round) => {
    const live = round.status === "open";
    const answers: PulseValue[] = [];
    for (const row of counts) {
      if (row.round_id !== round.id) continue;
      const n = Number(live ? row.present_n : row.all_n);
      for (let i = 0; i < n; i += 1) answers.push(row.value);
    }
    // Pad to the class size so "12 of 40" reads the way the instructor means it.
    const denominator = live ? denominators.present : Math.max(denominators.joined, answers.length);
    const padded: (PulseValue | null)[] = [
      ...answers,
      ...Array<null>(Math.max(0, denominator - answers.length)).fill(null),
    ];
    return {
      id: round.id,
      seq: round.seq,
      label: round.label,
      sectionId: round.section_id,
      sectionTitle: sections.find((section) => section.id === round.section_id)?.title ?? null,
      status: round.status,
      openedAt: round.opened_at.toISOString(),
      closedAt: round.closed_at ? round.closed_at.toISOString() : null,
      summary: summarisePulse(padded),
    };
  });
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
        section_id: string | null;
        activity_id: string | null;
      }[]
    >`
      select q.id, q.body, q.status, q.created_at, q.section_id, q.activity_id,
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

  const sections = await roomSections(room.id);
  const [activityRows, responseCounts, materials, timer] = await Promise.all([
    // The order the instructor put them in, so the console can show and change
    // it. Grouping by section is the console's job; the sequence is this one's.
    sql<ActivityRow[]>`
      select ${activityColumns()} from activities where room_id = ${room.id} order by seq asc`,
    activityResponseCounts(room.id),
    roomMaterials(room.id, sections),
    roomTimer(room.id),
  ]);

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
  const present = roster.filter((r) => r.present);

  // The denominator is the class in the room, so "12 of 40 answered" reads the
  // way the instructor means it.
  const rounds = await pulseRoundViews(room.id, sections, {
    present: present.length,
    joined: roster.length,
  });
  const currentRound = rounds.find((round) => round.status === "open") ?? null;

  return {
    role: "instructor",
    version: version(room),
    room: header(room, sections),
    joinUrl: joinUrl(origin, room.code),
    roster,
    presentCount: present.length,
    joinedCount: roster.length,
    activePoll: activePollRow
      ? toPollView(activePollRow, counts.get(activePollRow.id) ?? {}, "instructor")
      : null,
    polls: polls.map((p) => toPollView(p, counts.get(p.id) ?? {}, "instructor")),
    // Still the live readout the console has always shown; it is now the
    // current round's, rather than a column that had to be erased to be reused.
    pulse: currentRound?.summary ?? summarisePulse(Array(present.length).fill(null)),
    questions: questionRows.map((q) => ({
      id: q.id,
      body: q.body,
      votes: Number(q.votes),
      status: q.status,
      createdAt: q.created_at.toISOString(),
      votedByMe: null,
      authorName: q.author_name,
      sectionId: q.section_id,
      sectionTitle: sections.find((section) => section.id === q.section_id)?.title ?? null,
      activityId: q.activity_id,
      activityTitle: activityRows.find((a) => a.id === q.activity_id)?.title ?? null,
    })),
    picks: pickRows.map<PickView>((p) => ({
      id: p.id,
      displayName: p.display_name,
      createdAt: p.created_at.toISOString(),
    })),
    aiEnabled: isAiEnabled(),
    sections,
    pulseRound: currentRound,
    pulseHistory: rounds.filter((round) => round.status !== "open"),
    activities: activityRows.map((row) =>
      toActivityView(row, responseCounts.get(row.id), "instructor"),
    ),
    materials,
    timer,
  };
}

// --------------------------------------------------------------------- learner

export async function learnerSnapshot(
  room: RoomRow,
  participantId: string,
): Promise<LearnerSnapshot> {
  const sections = await roomSections(room.id);

  const [meRows, pollRows, questionRows, lastPick, openActivityRows, materials, timer, roundRows] =
    await Promise.all([
    sql<{ display_name: string }[]>`
      select display_name from participants where id = ${participantId}`,
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
        section_id: string | null;
        activity_id: string | null;
      }[]
    >`
      select q.id, q.body, q.status, q.created_at, q.section_id, q.activity_id,
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
    // Open, plus anything this learner answered and the instructor has since
    // closed. Their own work staying visible is what makes feedback readable
    // after the exercise has moved on.
    sql<ActivityRow[]>`
      select ${activityColumns()} from activities a
      where a.room_id = ${room.id}
        and (a.status = 'open'
             or exists (select 1 from activity_responses r
                        where r.activity_id = a.id and r.participant_id = ${participantId}))
        and a.status <> 'draft'
      order by (a.status = 'open') desc, coalesce(a.opened_at, a.created_at) desc
      limit 12`,
    roomMaterials(room.id, sections),
    roomTimer(room.id),
    sql<
      {
        id: string;
        seq: number;
        label: string | null;
        section_id: string | null;
        status: "open" | "closed";
      }[]
    >`
      select id, seq, label, section_id, status from pulse_rounds
      where room_id = ${room.id}
        ${
          // Live, only an open round matters: a closed round's answer must not
          // stay highlighted as if it carried into the next section. Once the
          // class has ended there is nothing to carry into, so the last round
          // is read instead — it is what keeps the learner's own final answer
          // visible on their phone after the end.
          room.status === "open" ? sql`and status = 'open'` : sql``
        }
      order by seq desc limit 1`,
  ]);

  // Only this learner's own rows. The query is keyed by their participant id,
  // so there is no filtering step that could be forgotten later.
  const mySubmissionRows = await sql<
    {
      activity_id: string;
      answers: unknown;
      review_state: MySubmission["reviewState"];
      feedback: string | null;
      updated_at: Date;
    }[]
  >`
    select activity_id, answers, review_state, feedback, updated_at
    from activity_responses
    where room_id = ${room.id} and participant_id = ${participantId}
    order by updated_at desc limit 50`;

  const myPulseRows = roundRows[0]
    ? await sql<{ value: PulseValue }[]>`
        select value from pulse_responses
        where round_id = ${roundRows[0].id} and participant_id = ${participantId}`
    : [];

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
    room: header(room, sections),
    me: { displayName: me?.display_name ?? "", pulse: myPulseRows[0]?.value ?? null },
    activePoll: pollRow ? toPollView(pollRow, counts.get(pollRow.id) ?? {}, "learner") : null,
    myAnswer: myAnswerRows[0]?.value ?? null,
    questions: questionRows.map((q) => ({
      id: q.id,
      body: q.body,
      votes: Number(q.votes),
      status: q.status,
      createdAt: q.created_at.toISOString(),
      votedByMe: q.voted,
      sectionId: q.section_id,
      sectionTitle: sections.find((section) => section.id === q.section_id)?.title ?? null,
      activityId: q.activity_id,
      activityTitle: openActivityRows.find((a) => a.id === q.activity_id)?.title ?? null,
    })),
    spotlight: (lastPick[0]?.participant_id ?? null) === participantId,
    sections,
    // Only a round that is actually collecting is offered as one to answer.
    // After the end the query above may return the final, closed round — that
    // exists to preserve `me.pulse`, not to present a round as live.
    pulseRound:
      roundRows[0] && roundRows[0].status === "open"
        ? {
            id: roundRows[0].id,
            seq: roundRows[0].seq,
            label: roundRows[0].label,
            sectionTitle:
              sections.find((section) => section.id === roundRows[0]!.section_id)?.title ?? null,
            status: roundRows[0].status,
          }
        : null,
    activities: openActivityRows.map((row) => toActivityView(row, undefined, "learner")),
    mySubmissions: mySubmissionRows.map<MySubmission>((row) => ({
      activityId: row.activity_id,
      answers: parseAnswers(row.answers),
      updatedAt: row.updated_at.toISOString(),
      reviewState: row.review_state,
      feedback: row.feedback,
    })),
    materials,
    timer,
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

  const sections = await roomSections(room.id);
  const [activityRows, timer, revealedRows] = await Promise.all([
    // The exercise the class is working on: the most recently started one,
    // whether or not it is still collecting, so a closed activity stays legible
    // on the projector while it is discussed.
    sql<ActivityRow[]>`
      select ${activityColumns()} from activities
      where room_id = ${room.id} and status in ('open', 'closed')
      order by coalesce(opened_at, created_at) desc limit 1`,
    roomTimer(room.id),
    // Exactly one response, only while the instructor has revealed it, and only
    // the columns the projector needs. review_state and feedback are not
    // selected at all: nothing private can leak from a query that never asks
    // for it, whatever a component later decides to render.
    room.public_mode === "response" && room.status === "open"
      ? sql<
          { answers: unknown; reveal_author: boolean; display_name: string; title: string; fields: unknown }[]
        >`
          select r.answers, r.reveal_author, p.display_name, a.title, a.fields
          from activity_responses r
          join participants p on p.id = r.participant_id
          join activities a on a.id = r.activity_id
          where r.room_id = ${room.id} and r.revealed
          limit 1`
      : Promise.resolve([] as {
          answers: unknown;
          reveal_author: boolean;
          display_name: string;
          title: string;
          fields: unknown;
        }[]),
  ]);

  const revealed = revealedRows[0];
  const revealedResponse: RevealedResponseView | null = revealed
    ? {
        activityTitle: revealed.title,
        fields: parseFields(revealed.fields),
        answers: parseAnswers(revealed.answers),
        // Anonymous by default. A name reaches the projector only because the
        // instructor asked for it on this specific response.
        authorName: revealed.reveal_author ? revealed.display_name : null,
      }
    : null;

  // The section's name belongs on the projector; its id does not, and the
  // screen has nothing to use one for. The pulse context stays off it for the
  // same reason: the projector never taps, so the field would be surface
  // without a purpose — and the public payload is allow-listed by test.
  const { pulseEpoch: _pulseEpoch, ...publicHeader } = header(room, sections);

  return {
    role: "public",
    version: version(room),
    room: { ...publicHeader, currentSectionId: null },
    joinUrl: joinUrl(origin, room.code),
    presentCount: Number(presentRows[0]?.n ?? 0),
    activePoll: pollRow ? toPollView(pollRow, counts.get(pollRow.id) ?? {}, "public") : null,
    lastPick: pick ? { displayName: pick.display_name } : null,
    activity: activityRows[0]
      ? {
          // Deliberately not toActivityView: the projector never acts on
          // anything, so it is given no row identifiers to act with. Keeping
          // that property is what lets the authorisation suite assert that no
          // UUID ever reaches the shared screen.
          title: activityRows[0].title,
          instructions: activityRows[0].instructions,
          fields: parseFields(activityRows[0].fields),
          status: activityRows[0].status,
        }
      : null,
    revealedResponse,
    timer: timer
      ? {
          label: timer.label,
          status: timer.status,
          durationSeconds: timer.durationSeconds,
          endsAt: timer.endsAt,
          remainingSeconds: timer.remainingSeconds,
        }
      : null,
  };
}

// -------------------------------------------------- instructor review list

/**
 * Every submission for one activity, named.
 *
 * Instructor-only by construction: the single caller is a route that has
 * already required the host token, and no snapshot builder calls it. Learners
 * are told before they submit that their work is named to the instructor, which
 * is what makes "invite the author to explain" possible at all.
 */
export async function activityResponses(
  room: RoomRow,
  activityId: string,
): Promise<ActivityResponseView[]> {
  const rows = await sql<
    {
      id: string;
      activity_id: string;
      participant_id: string | null;
      display_name: string | null;
      answers: unknown;
      review_state: ReviewState;
      feedback: string | null;
      revealed: boolean;
      reveal_author: boolean;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    select r.id, r.activity_id, r.participant_id, p.display_name, r.answers, r.review_state,
           r.feedback, r.revealed, r.reveal_author, r.created_at, r.updated_at
    from activity_responses r
    left join participants p on p.id = r.participant_id
    where r.room_id = ${room.id} and r.activity_id = ${activityId}
    order by r.created_at asc`;

  return rows.map((row) => ({
    id: row.id,
    activityId: row.activity_id,
    participantId: row.participant_id,
    displayName: row.display_name ?? "Someone who has left",
    answers: parseAnswers(row.answers),
    reviewState: row.review_state,
    feedback: row.feedback,
    revealed: row.revealed,
    revealAuthor: row.reveal_author,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}
