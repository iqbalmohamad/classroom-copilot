import "server-only";
import { sql, type Tx } from "./db";
import { ApiError } from "./http";
import type { RoomRow } from "./auth";
import { resolveSection } from "./service";
import { normaliseFields, parseFields, validateAnswers, type ActivityField } from "./domain/activities";
import { safeHttpUrl } from "./domain/links";
import { autoSectionTitle, MAX_SECTIONS, permutationOf } from "./domain/sections";
import type {
  CreateActivityInput,
  CreateMaterialInput,
  ReviewResponseInput,
  StartTimerInput,
  UpdateActivityInput,
  UpdateMaterialInput,
} from "./validation";

/**
 * The taught-session mutations: sections, activities, review, timers, materials.
 *
 * Separate from service.ts only for size — the rules are the same. Every
 * function is one short transaction, nothing trusts its caller, and the routes
 * above have already established who is asking.
 */

type Db = Tx | typeof sql;

async function logEvent(tx: Db, roomId: string, kind: string, payload: object = {}) {
  await tx`insert into session_events (room_id, kind, payload)
           values (${roomId}, ${kind}, ${sql.json(payload as never)})`;
}

async function lockRoom(tx: Tx, roomId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
}

function assertRoomOpen(room: RoomRow) {
  if (room.status !== "open") throw new ApiError("gone", "This class session has ended.");
}

// --------------------------------------------------------------- sections

export async function createSection(
  room: RoomRow,
  options: { title?: string; afterId?: string | null } = {},
): Promise<{ id: string; position: number }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);

    const existing = await tx<{ id: string; position: number }[]>`
      select id, position from sections where room_id = ${room.id} order by position asc`;
    if (existing.length >= MAX_SECTIONS) {
      throw new ApiError("conflict", `A class can hold at most ${MAX_SECTIONS} sections.`);
    }

    const after = options.afterId
      ? existing.find((section) => section.id === options.afterId)
      : undefined;
    if (options.afterId && !after) {
      throw new ApiError("bad_request", "That section is not part of this class.");
    }

    const position = after ? after.position + 1 : existing.length + 1;
    if (after) {
      // Deferred unique constraint, so the whole block can shift in one write.
      await tx`update sections set position = position + 1
               where room_id = ${room.id} and position >= ${position}`;
    }

    const title = (options.title ?? "").trim().slice(0, 80) || autoSectionTitle(position);
    const rows = await tx<{ id: string }[]>`
      insert into sections (room_id, position, title) values (${room.id}, ${position}, ${title})
      returning id`;

    await logEvent(tx, room.id, "section_created", { position });
    return { id: rows[0]!.id, position };
  });
}

export async function renameSection(room: RoomRow, sectionId: string, title: string): Promise<void> {
  const clean = title.trim().slice(0, 80);
  if (clean.length === 0) throw new ApiError("bad_request", "Give the section a name.");
  const updated = await sql`
    update sections set title = ${clean} where id = ${sectionId} and room_id = ${room.id}
    returning id`;
  if (updated.length === 0) throw new ApiError("not_found", "That section no longer exists.");
}

export async function reorderSections(room: RoomRow, order: string[]): Promise<void> {
  assertRoomOpen(room);

  await sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const current = await tx<{ id: string }[]>`
      select id from sections where room_id = ${room.id} order by position asc`;

    const next = permutationOf(current.map((row) => row.id), order);
    if (!next) {
      // Half-applying a reorder would interleave a prepared plan with itself,
      // which is worse than refusing and asking the console to re-read.
      throw new ApiError("conflict", "The section list has changed. Reload and try again.");
    }

    for (const [index, id] of next.entries()) {
      await tx`update sections set position = ${index + 1} where id = ${id}`;
    }
    await logEvent(tx, room.id, "sections_reordered", { count: next.length });
  });
}

export async function deleteSection(room: RoomRow, sectionId: string): Promise<void> {
  assertRoomOpen(room);

  await sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const sections = await tx<{ id: string; position: number }[]>`
      select id, position from sections where room_id = ${room.id} order by position asc`;
    if (sections.length <= 1) {
      throw new ApiError("conflict", "A class keeps at least one section.");
    }
    const target = sections.find((section) => section.id === sectionId);
    if (!target) throw new ApiError("not_found", "That section no longer exists.");

    // Polls, activities, questions and pulse rounds keep their own history; the
    // foreign keys null the link rather than cascading, so deleting a section
    // never deletes what the class did inside it.
    await tx`delete from sections where id = ${sectionId}`;
    await tx`update sections set position = position - 1
             where room_id = ${room.id} and position > ${target.position}`;

    const fallback = sections.find((section) => section.id !== sectionId)!;
    await tx`update rooms set current_section_id = ${fallback.id}
             where id = ${room.id} and current_section_id is null`;
    await logEvent(tx, room.id, "section_deleted", {});
  });
}

/**
 * Move the class to a section, or on to the next one.
 *
 * Navigation, with exactly one consequence: a pulse round belonging to the
 * section being left is closed.
 *
 * Leaving it open was wrong. The round carries the section it was asked about,
 * so a learner tapping after the class moved on would have been counted against
 * the part of the lesson they are no longer in — the instructor would read
 * "Section 2: 3 lost" and be looking at answers about Section 1. Closing it
 * preserves every response as history, and the next round opens in the new
 * section either when the instructor asks or when the class taps.
 *
 * Everything else is still untouched: no draft poll or activity is published,
 * nothing that is collecting answers is closed, and no result is erased.
 *
 * The whole thing happens under the room's advisory lock, so a learner
 * submitting a pulse at the same moment either lands in the old round before it
 * closes or is refused for naming a closed one — never silently redirected.
 */
export async function selectSection(
  room: RoomRow,
  sectionId?: string | null,
): Promise<{ id: string; title: string; created: boolean }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);

    // Re-read inside the lock. The row this request loaded may be several
    // navigations old if two console tabs are open.
    const current = (
      await tx<{ current_section_id: string | null }[]>`
        select current_section_id from rooms where id = ${room.id}`
    )[0];

    const sections = await tx<{ id: string; position: number; title: string }[]>`
      select id, position, title from sections where room_id = ${room.id} order by position asc`;

    /**
     * Points the room at a section and closes a round left behind by the move.
     *
     * pulse_rounds before rooms, and not the other way round. setPulse holds a
     * share lock on the open round and then reaches `rooms` through the version
     * trigger, so taking `rooms` first here put the two in opposite orders and
     * deadlocked a learner tapping at the moment the class moved on — which is
     * precisely the moment this code exists for.
     */
    const goTo = async (target: { id: string; title: string }) => {
      // A round already asked about the destination stays open; only one about
      // somewhere else is closed. Its answers remain, as history.
      await tx`
        update pulse_rounds set status = 'closed', closed_at = now()
        where room_id = ${room.id}
          and status = 'open'
          and section_id is distinct from ${target.id}`;
      await tx`update rooms set current_section_id = ${target.id} where id = ${room.id}`;
      return target;
    };

    if (sectionId) {
      const target = sections.find((section) => section.id === sectionId);
      if (!target) throw new ApiError("bad_request", "That section is not part of this class.");
      await goTo(target);
      await logEvent(tx, room.id, "section_selected", { position: target.position });
      return { id: target.id, title: target.title, created: false };
    }

    const currentIndex = sections.findIndex(
      (section) => section.id === current?.current_section_id,
    );
    const next = sections[currentIndex + 1];
    if (next) {
      await goTo(next);
      await logEvent(tx, room.id, "section_selected", { position: next.position });
      return { id: next.id, title: next.title, created: false };
    }

    // Nothing prepared past here: make one. This is what "Next" does for an
    // instructor who never opened the planner.
    if (sections.length >= MAX_SECTIONS) {
      throw new ApiError("conflict", `A class can hold at most ${MAX_SECTIONS} sections.`);
    }
    const position = sections.length + 1;
    const title = autoSectionTitle(position);
    const created = await tx<{ id: string }[]>`
      insert into sections (room_id, position, title) values (${room.id}, ${position}, ${title})
      returning id`;
    await goTo({ id: created[0]!.id, title });
    await logEvent(tx, room.id, "section_created", { position, viaNext: true });
    return { id: created[0]!.id, title, created: true };
  });
}

// ------------------------------------------------------------- activities

export async function createActivity(
  room: RoomRow,
  input: CreateActivityInput,
  prepared?: {
    title?: string;
    fields: ActivityField[];
    instructions?: string | null;
    referenceAnswer?: string | null;
  },
): Promise<{ id: string }> {
  assertRoomOpen(room);

  const title = (input.title ?? "").trim() || prepared?.title?.trim() || "";
  if (!title) throw new ApiError("bad_request", "Give the activity a title.");

  const fields = prepared?.fields ?? normaliseFields(input.fields);
  const instructions =
    (input.instructions ?? prepared?.instructions ?? "")?.toString().trim().slice(0, 2000) || null;
  const referenceAnswer =
    (input.referenceAnswer ?? prepared?.referenceAnswer ?? "")?.toString().trim().slice(0, 4000) ||
    null;

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const sectionId = await resolveSection(tx, room, input.sectionId ?? undefined);

    const seqRows = await tx<{ next: number }[]>`
      select coalesce(max(seq), 0) + 1 as next from activities where room_id = ${room.id}`;
    const seq = seqRows[0]?.next ?? 1;

    const rows = await tx<{ id: string }[]>`
      insert into activities
        (room_id, section_id, seq, title, instructions, fields, status, reference_answer,
         duration_seconds, opened_at)
      values (${room.id}, ${sectionId}, ${seq}, ${title}, ${instructions},
              ${sql.json(fields as never)}, ${input.openNow ? "open" : "draft"},
              ${referenceAnswer}, ${input.durationSeconds ?? null},
              ${input.openNow ? sql`now()` : null})
      returning id`;

    if (input.openNow) {
      await tx`update rooms set public_mode = 'activity' where id = ${room.id}`;
    }
    await logEvent(tx, room.id, "activity_created", { seq, openNow: !!input.openNow });
    return { id: rows[0]!.id };
  });
}

export async function updateActivity(
  room: RoomRow,
  activityId: string,
  input: UpdateActivityInput,
): Promise<void> {
  assertRoomOpen(room);

  await sql.begin(async (tx) => {
    const rows = await tx<{ status: string }[]>`
      select status from activities where id = ${activityId} and room_id = ${room.id} for update`;
    if (!rows[0]) throw new ApiError("not_found", "That activity no longer exists.");

    const sectionId =
      input.sectionId === undefined ? undefined : await resolveSection(tx, room, input.sectionId);

    let fields: ActivityField[] | undefined;
    if (input.fields) {
      const answered = await tx<{ n: string }[]>`
        select count(*)::text as n from activity_responses where activity_id = ${activityId}`;
      if (Number(answered[0]?.n ?? 0) > 0) {
        // Editing the questions under answers already given would silently
        // re-attribute them. Running it again is the supported way to change a
        // prompt the class has answered.
        throw new ApiError(
          "conflict",
          "Learners have already answered this. Use “Run again” to ask a changed version.",
        );
      }
      fields = normaliseFields(input.fields);
    }

    await tx`
      update activities set
        title = ${input.title?.trim() ?? sql`title`},
        instructions = ${
          input.instructions === undefined
            ? sql`instructions`
            : (input.instructions?.trim().slice(0, 2000) || null)
        },
        fields = ${fields ? sql.json(fields as never) : sql`fields`},
        section_id = ${sectionId === undefined ? sql`section_id` : sectionId},
        reference_answer = ${
          input.referenceAnswer === undefined
            ? sql`reference_answer`
            : (input.referenceAnswer?.trim().slice(0, 4000) || null)
        },
        duration_seconds = ${
          input.durationSeconds === undefined ? sql`duration_seconds` : (input.durationSeconds ?? null)
        }
      where id = ${activityId}`;

    await logEvent(tx, room.id, "activity_updated", { activityId });
  });
}

/**
 * Puts prepared activities in the order the instructor wants to run them.
 *
 * `seq` is that order, and it is what a saved plan preserves, so a deck
 * reordered here comes back reordered next term. Accepted only as a complete
 * permutation, under the room's lock: a partial list would leave positions to
 * be inferred, and inferring them is how a prepared session ends up interleaved
 * with itself.
 */
export async function reorderActivities(room: RoomRow, order: string[]): Promise<void> {
  assertRoomOpen(room);

  await sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const current = await tx<{ id: string }[]>`
      select id from activities where room_id = ${room.id} order by seq asc`;

    const next = permutationOf(current.map((row) => row.id), order);
    if (!next) {
      throw new ApiError("conflict", "The activity list has changed. Reload and try again.");
    }

    // One pass, relying on the deferred unique constraint from 0004.
    for (const [index, id] of next.entries()) {
      await tx`update activities set seq = ${index + 1} where id = ${id}`;
    }
    await logEvent(tx, room.id, "activities_reordered", { count: next.length });
  });
}

export type ActivityAction = "open" | "close" | "again" | "delete";

export async function actOnActivity(
  room: RoomRow,
  activityId: string,
  action: ActivityAction,
): Promise<{ id: string }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const rows = await tx<
      {
        id: string;
        seq: number;
        section_id: string | null;
        title: string;
        instructions: string | null;
        fields: unknown;
        status: string;
        attempt: number;
        origin_id: string | null;
        reference_answer: string | null;
        duration_seconds: number | null;
      }[]
    >`
      select id, seq, section_id, title, instructions, fields, status, attempt, origin_id,
             reference_answer, duration_seconds
      from activities where id = ${activityId} and room_id = ${room.id} for update`;
    const activity = rows[0];
    if (!activity) throw new ApiError("not_found", "That activity no longer exists.");

    if (action === "open") {
      if (activity.status === "open") throw new ApiError("conflict", "That activity is already open.");
      await tx`update activities set status = 'open', opened_at = now(), closed_at = null
               where id = ${activityId}`;
      await tx`update rooms set public_mode = 'activity' where id = ${room.id}`;
      await logEvent(tx, room.id, "activity_opened", { activityId });
      return { id: activityId };
    }

    if (action === "close") {
      if (activity.status !== "open") throw new ApiError("conflict", "That activity is not open.");
      await tx`update activities set status = 'closed', closed_at = now() where id = ${activityId}`;
      await logEvent(tx, room.id, "activity_closed", { activityId });
      return { id: activityId };
    }

    if (action === "delete") {
      const answered = await tx<{ n: string }[]>`
        select count(*)::text as n from activity_responses where activity_id = ${activityId}`;
      if (Number(answered[0]?.n ?? 0) > 0) {
        throw new ApiError("conflict", "Learners have answered this, so it is kept in the record.");
      }
      await tx`delete from activities where id = ${activityId}`;
      await logEvent(tx, room.id, "activity_deleted", { activityId });
      return { id: activityId };
    }

    // "again": a fresh attempt rather than a reopen, so the first set of
    // answers stays exactly as it was submitted — the same reasoning as
    // askAgain for polls.
    const seqRows = await tx<{ next: number }[]>`
      select coalesce(max(seq), 0) + 1 as next from activities where room_id = ${room.id}`;
    const created = await tx<{ id: string }[]>`
      insert into activities
        (room_id, section_id, seq, title, instructions, fields, status, attempt, origin_id,
         reference_answer, duration_seconds, opened_at)
      values (${room.id}, ${activity.section_id}, ${seqRows[0]?.next ?? 1}, ${activity.title},
              ${activity.instructions}, ${sql.json(parseFields(activity.fields) as never)}, 'open',
              ${activity.attempt + 1}, ${activity.origin_id ?? activity.id},
              ${activity.reference_answer}, ${activity.duration_seconds}, now())
      returning id`;

    if (activity.status === "open") {
      await tx`update activities set status = 'closed', closed_at = now() where id = ${activityId}`;
    }
    await tx`update rooms set public_mode = 'activity' where id = ${room.id}`;
    await logEvent(tx, room.id, "activity_again", { from: activityId });
    return { id: created[0]!.id };
  });
}

/**
 * One learner's submission.
 *
 * Upsert on (activity, participant): editing while it is open replaces, it does
 * not add a second row, and a closed activity refuses the write inside the same
 * transaction that read its status — so an answer racing a close is rejected
 * rather than landing after it.
 */
export async function submitActivityResponse(
  room: RoomRow,
  activityId: string,
  participantId: string,
  rawAnswers: unknown,
): Promise<{ answers: Record<string, string> }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    // Participants before rooms — see the lock-order note in service.ts. It has
    // to come before the enforcement below, which reaches `rooms` through the
    // version triggers on timers and activities.
    await tx`update participants set last_seen_at = now() where id = ${participantId}`;

    // Apply any elapsed deadline first, in this transaction. Without it the
    // status read below is only as fresh as the last snapshot anyone happened
    // to build, and an answer arriving a minute after the bell would be
    // accepted purely because nobody had looked at the room since.
    await enforceTimersIn(tx, room.id);

    const rows = await tx<{ status: string; fields: unknown }[]>`
      select status, fields from activities
      where id = ${activityId} and room_id = ${room.id} for share`;
    const activity = rows[0];
    if (!activity) throw new ApiError("not_found", "That activity is no longer available.");
    if (activity.status !== "open") {
      throw new ApiError("conflict", "This activity is closed. Your answer was not recorded.");
    }

    const check = validateAnswers(parseFields(activity.fields), rawAnswers);
    if (!check.ok) throw new ApiError("bad_request", check.reason);

    await tx`
      insert into activity_responses (activity_id, participant_id, room_id, answers)
      values (${activityId}, ${participantId}, ${room.id}, ${sql.json(check.answers as never)})
      on conflict (activity_id, participant_id)
      do update set answers = excluded.answers, updated_at = now()`;

    return { answers: check.answers };
  });
}

/**
 * Instructor review of one response: state, private feedback, reveal, invite.
 *
 * Feedback is written here and read back only by its author's own learner
 * projection and by the instructor. Revealing is separate from naming: putting
 * a response on the projector shows the answer, and the author's name only if
 * the instructor also asked for that.
 */
export async function reviewResponse(
  room: RoomRow,
  responseId: string,
  input: ReviewResponseInput,
): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; participant_id: string | null; revealed: boolean }[]
    >`
      select id, participant_id, revealed from activity_responses
      where id = ${responseId} and room_id = ${room.id} for update`;
    const response = rows[0];
    if (!response) throw new ApiError("not_found", "That response no longer exists.");

    if (input.reveal !== undefined) {
      if (input.reveal) {
        // One at a time: the projector shows a single response, and the partial
        // unique index would reject a second anyway.
        await tx`update activity_responses set revealed = false
                 where room_id = ${room.id} and revealed and id <> ${responseId}`;
        await tx`update rooms set public_mode = 'response' where id = ${room.id}`;
      } else if (room.public_mode === "response") {
        await tx`update rooms set public_mode = 'activity' where id = ${room.id}`;
      }
    }

    await tx`
      update activity_responses set
        review_state = ${input.reviewState ?? sql`review_state`},
        feedback = ${
          input.feedback === undefined ? sql`feedback` : (input.feedback?.trim() || null)
        },
        feedback_at = ${input.feedback === undefined ? sql`feedback_at` : sql`now()`},
        revealed = ${input.reveal === undefined ? sql`revealed` : input.reveal},
        reveal_author = ${input.revealAuthor === undefined ? sql`reveal_author` : input.revealAuthor},
        updated_at = now()
      where id = ${responseId}`;

    if (input.invite && response.participant_id) {
      // Recorded as a pick so the author gets the spotlight on their own phone
      // and the picker's fairness history counts it, exactly like being called
      // on any other way.
      const name = await tx<{ display_name: string }[]>`
        select display_name from participants where id = ${response.participant_id}`;
      if (name[0]) {
        await tx`insert into picks (room_id, participant_id, display_name)
                 values (${room.id}, ${response.participant_id}, ${name[0].display_name})`;
        await logEvent(tx, room.id, "response_author_invited", { responseId });
      }
    }

    await logEvent(tx, room.id, "response_reviewed", {
      responseId,
      reviewState: input.reviewState ?? null,
      revealed: input.reveal ?? null,
    });
  });
}

// ------------------------------------------------------------------ timers

/**
 * Close out timers whose deadline has passed, inside the caller's transaction.
 *
 * The deadline is enforced here, at the write boundary, not by a scheduler and
 * not by whichever surface happens to read state next. Every write that could
 * be affected by an elapsed timer calls this first, in its own transaction, so
 * an answer posted after the bell is refused even if nobody has looked at the
 * room since — a submission must not depend on someone else having rendered a
 * snapshot.
 *
 * Ending the timer and closing its activity are one statement pair in one
 * transaction, so the pair cannot be left half-applied: there is no moment at
 * which the clock has stopped but the activity is still taking answers.
 */
export async function enforceTimersIn(tx: Tx, roomId: string): Promise<void> {
  const expired = await tx<{ id: string; activity_id: string | null; auto_close: boolean }[]>`
    update timers
    set status = 'ended', expired = true, ended_at = ends_at
    where room_id = ${roomId} and status = 'running' and ends_at <= now()
    returning id, activity_id, auto_close`;

  for (const timer of expired) {
    if (timer.auto_close && timer.activity_id) {
      await tx`update activities set status = 'closed', closed_at = now()
               where id = ${timer.activity_id} and status = 'open'`;
    }
    await logEvent(tx, roomId, "timer_expired", {
      timerId: timer.id,
      autoClose: timer.auto_close,
    });
  }
}

/** The same enforcement for a caller that has no transaction of its own. */
export async function enforceTimers(roomId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await enforceTimersIn(tx, roomId);
  });
}

export async function startTimer(room: RoomRow, input: StartTimerInput): Promise<{ id: string }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);

    if (input.activityId) {
      const owns = await tx<{ id: string }[]>`
        select id from activities where id = ${input.activityId} and room_id = ${room.id}`;
      if (!owns[0]) throw new ApiError("bad_request", "That activity is not part of this class.");
    }

    // One clock at a time. Two countdowns on a projector is a bug the class
    // reports, not a feature.
    await tx`update timers set status = 'ended', ended_at = now()
             where room_id = ${room.id} and status <> 'ended'`;

    const label = (input.label ?? "").trim().slice(0, 60) || (input.activityId ? "Activity" : "Break");
    const rows = await tx<{ id: string }[]>`
      insert into timers (room_id, activity_id, label, duration_seconds, status, ends_at, auto_close)
      values (${room.id}, ${input.activityId ?? null}, ${label}, ${input.durationSeconds},
              'running', now() + make_interval(secs => ${input.durationSeconds}),
              ${input.autoClose ?? false})
      returning id`;

    await logEvent(tx, room.id, "timer_started", {
      seconds: input.durationSeconds,
      autoClose: !!input.autoClose,
    });
    return { id: rows[0]!.id };
  });
}

export async function actOnTimer(
  room: RoomRow,
  timerId: string,
  action: "pause" | "resume" | "extend" | "end",
  seconds?: number,
): Promise<void> {
  await sql.begin(async (tx) => {
    // The clock may have run out since the console last rendered. Settle that
    // first, so pause/resume/extend act on what the timer actually is rather
    // than on what the instructor's screen last showed.
    await enforceTimersIn(tx, room.id);

    const rows = await tx<
      {
        id: string;
        status: string;
        ends_at: Date | null;
        remaining_seconds: number | null;
        activity_id: string | null;
        auto_close: boolean;
      }[]
    >`
      select id, status, ends_at, remaining_seconds, activity_id, auto_close
      from timers where id = ${timerId} and room_id = ${room.id} for update`;
    const timer = rows[0];
    if (!timer) throw new ApiError("not_found", "That timer no longer exists.");

    if (timer.status === "ended") {
      // Extending a finished timer would quietly reopen submissions the class
      // has already been told are closed. Say so, and make starting a new one
      // the deliberate act it should be.
      throw new ApiError(
        "conflict",
        "That timer has finished. Start a new one — and reopen the activity yourself if you " +
          "want more answers.",
      );
    }

    if (action === "pause") {
      if (timer.status !== "running") throw new ApiError("conflict", "That timer is not running.");
      await tx`
        update timers
        set status = 'paused',
            remaining_seconds = greatest(0, ceil(extract(epoch from (ends_at - now()))))::int,
            ends_at = null
        where id = ${timerId}`;
    } else if (action === "resume") {
      if (timer.status !== "paused") throw new ApiError("conflict", "That timer is not paused.");
      await tx`
        update timers
        set status = 'running',
            ends_at = now() + make_interval(secs => coalesce(remaining_seconds, 0)),
            remaining_seconds = null
        where id = ${timerId}`;
    } else if (action === "extend") {
      const extra = Math.max(10, Math.min(3600, Math.round(seconds ?? 60)));
      if (timer.status === "running") {
        await tx`update timers set ends_at = ends_at + make_interval(secs => ${extra})
                 where id = ${timerId}`;
      } else {
        await tx`update timers
                 set remaining_seconds = coalesce(remaining_seconds, 0) + ${extra}
                 where id = ${timerId}`;
      }
    } else {
      await tx`update timers set status = 'ended', ended_at = now(), ends_at = null,
                                 remaining_seconds = null
               where id = ${timerId}`;
      // Ending by hand honours the same auto-close choice the instructor made
      // when they started it, so "time's up" means the same thing either way.
      if (timer.auto_close && timer.activity_id) {
        await tx`update activities set status = 'closed', closed_at = now()
                 where id = ${timer.activity_id} and status = 'open'`;
      }
    }

    await logEvent(tx, room.id, `timer_${action}`, { timerId });
  });
}

// --------------------------------------------------------------- materials

export async function createMaterial(
  room: RoomRow,
  input: CreateMaterialInput,
): Promise<{ id: string }> {
  const url = safeHttpUrl(input.url);
  if (!url) {
    throw new ApiError("bad_request", "Enter a web address starting with http:// or https://.");
  }

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const sectionId =
      input.sectionId === undefined ? null : await resolveSection(tx, room, input.sectionId);

    const positions = await tx<{ next: number }[]>`
      select coalesce(max(position), 0) + 1 as next from materials where room_id = ${room.id}`;

    const rows = await tx<{ id: string }[]>`
      insert into materials (room_id, section_id, position, title, url, note, highlighted)
      values (${room.id}, ${sectionId}, ${positions[0]?.next ?? 1}, ${input.title.trim()},
              ${url}, ${input.note?.trim() || null}, ${input.highlighted ?? false})
      returning id`;

    await logEvent(tx, room.id, "material_added", {});
    return { id: rows[0]!.id };
  });
}

export async function updateMaterial(
  room: RoomRow,
  materialId: string,
  input: UpdateMaterialInput,
): Promise<void> {
  let url: string | undefined;
  if (input.url !== undefined) {
    const safe = safeHttpUrl(input.url);
    if (!safe) {
      throw new ApiError("bad_request", "Enter a web address starting with http:// or https://.");
    }
    url = safe;
  }

  await sql.begin(async (tx) => {
    const sectionId =
      input.sectionId === undefined ? undefined : await resolveSection(tx, room, input.sectionId);

    const updated = await tx`
      update materials set
        title = ${input.title?.trim() ?? sql`title`},
        url = ${url ?? sql`url`},
        note = ${input.note === undefined ? sql`note` : (input.note?.trim() || null)},
        section_id = ${sectionId === undefined ? sql`section_id` : sectionId},
        highlighted = ${input.highlighted === undefined ? sql`highlighted` : input.highlighted}
      where id = ${materialId} and room_id = ${room.id}
      returning id`;
    if (updated.length === 0) throw new ApiError("not_found", "That material no longer exists.");
  });
}

export async function deleteMaterial(room: RoomRow, materialId: string): Promise<void> {
  const removed = await sql`
    delete from materials where id = ${materialId} and room_id = ${room.id} returning id`;
  if (removed.length === 0) throw new ApiError("not_found", "That material no longer exists.");
  await logEvent(sql, room.id, "material_removed", {});
}
