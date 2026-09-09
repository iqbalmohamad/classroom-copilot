import "server-only";
import { sql, type Tx } from "./db";
import { ApiError } from "./http";
import type { RoomRow } from "./auth";
import { generateRoomCode, generateToken, hashToken, randomChoice } from "./ids";
import { buildOptions, isValidResponse, transition, type PollAction } from "./domain/polls";
import { parsePollOptions } from "./domain/json";
import { choosePick } from "./domain/picker";
import { disambiguate, normalizeDisplayName, isValidDisplayName } from "./domain/names";
import { PRESENCE_WINDOW_MS, type PublicMode, type PulseValue } from "./types";
import type { CreatePollInput } from "./validation";

/**
 * Every classroom mutation.
 *
 * Each function is a single short transaction so that concurrent learners never
 * observe half-applied state, and so the room version (bumped by triggers)
 * advances exactly once per meaningful change. Nothing here trusts its caller:
 * routes do authorisation, this layer re-checks the classroom rules.
 */

type Db = Tx | typeof sql;

async function logEvent(tx: Db, roomId: string, kind: string, payload: object = {}) {
  // sql.json() hands postgres.js the value to encode. Passing a pre-stringified
  // value here would be encoded a second time and land as a JSON string.
  await tx`insert into session_events (room_id, kind, payload)
           values (${roomId}, ${kind}, ${sql.json(payload as never)})`;
}

/**
 * Serialise writes that allocate something room-scoped.
 *
 * `polls.seq` is computed with max(seq)+1 and "one open poll per room" is a
 * partial unique index — under READ COMMITTED neither is safe against two
 * overlapping transactions, and an instructor double-clicking Open is not an
 * exotic case. A transaction-scoped advisory lock costs microseconds and turns
 * both races into a queue.
 */
async function lockRoom(tx: Tx, roomId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${roomId}, 0))`;
}

function assertRoomOpen(room: RoomRow) {
  if (room.status !== "open") {
    throw new ApiError("gone", "This class session has ended.");
  }
}

// ------------------------------------------------------------------- rooms

export async function createRoom(title: string | undefined): Promise<{
  room: RoomRow;
  hostToken: string;
}> {
  const hostToken = generateToken();
  const hash = hashToken(hostToken);
  const cleanTitle = (title ?? "").trim().slice(0, 80) || "Class session";

  // Codes are short by design, so a collision is possible; retry a few times
  // rather than lengthening the code the instructor has to read aloud.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateRoomCode();
    try {
      const rows = await sql<RoomRow[]>`
        insert into rooms (code, title, host_token_hash)
        values (${code}, ${cleanTitle}, ${hash})
        returning id, code, title, host_token_hash, status, public_mode, version,
                  current_section_id, created_at, ended_at`;
      const room = rows[0]!;
      // Every room gets one section immediately. An instructor who never opens
      // the planner simply teaches inside it and never sees the word "section";
      // one who does has something to rename rather than a blank slate to
      // configure before the class can start.
      const section = await sql<{ id: string }[]>`
        insert into sections (room_id, position, title) values (${room.id}, 1, 'Section 1')
        returning id`;
      await sql`update rooms set current_section_id = ${section[0]!.id} where id = ${room.id}`;
      room.current_section_id = section[0]!.id;
      await logEvent(sql, room.id, "room_created", { title: cleanTitle });
      return { room, hostToken };
    } catch (error) {
      const code23505 = (error as { code?: string }).code === "23505";
      if (!code23505) throw error;
    }
  }
  throw new ApiError("server_error", "Could not allocate a room code. Please try again.");
}

export async function endRoom(room: RoomRow): Promise<void> {
  await sql.begin(async (tx) => {
    // Close any poll still collecting. Besides being the right end state, this
    // is what stops an answer that was already in flight from landing in a room
    // that has just ended: respondToPoll re-checks the poll status under a lock.
    await closeOpenPolls(tx, room.id);
    await tx`update rooms set status = 'ended', ended_at = now() where id = ${room.id}`;
    await logEvent(tx, room.id, "room_ended");
  });
}

/**
 * Point the presentation screen at something.
 *
 * Choosing a screen is a display decision and nothing more. In particular
 * choosing the results screen does not reveal results: revealing is the
 * instructor's separate, deliberate act, and one control quietly performing the
 * other is how a distribution ends up in front of a class that was not meant to
 * see it yet. When results are not revealed the screen keeps the question up,
 * and the console says so rather than leaving the instructor to discover it by
 * turning round.
 */
export async function setPublicMode(room: RoomRow, mode: PublicMode): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`update rooms set public_mode = ${mode} where id = ${room.id}`;
  });
}

// ------------------------------------------------------------ participants

export interface JoinResult {
  participantId: string;
  displayName: string;
  token: string;
  rejoined: boolean;
}

/**
 * Join, or re-join with an identity the learner already holds.
 *
 * Passing the token the browser already has is what makes a refresh a no-op:
 * the same participant row is reused, so the roster does not grow a ghost and
 * the learner's pulse and poll answer survive. Only a learner without a valid
 * token creates a new row.
 */
export async function joinRoom(
  room: RoomRow,
  rawName: string,
  existingToken: string | null,
): Promise<JoinResult> {
  assertRoomOpen(room);

  const name = normalizeDisplayName(rawName);
  if (!isValidDisplayName(name)) {
    throw new ApiError("bad_request", "Please enter a name (1–40 characters).");
  }

  return sql.begin(async (tx) => {
    // Serialise joins for this room so two learners typing the same name at the
    // same moment still get distinguishable roster entries.
    await lockRoom(tx, room.id);

    if (existingToken) {
      const hash = hashToken(existingToken);
      const existing = await tx<{ id: string; display_name: string }[]>`
        select id, display_name from participants
        where room_id = ${room.id} and token_hash = ${hash}`;
      const row = existing[0];
      if (row) {
        const taken = await tx<{ display_name: string }[]>`
          select display_name from participants
          where room_id = ${room.id} and id <> ${row.id}`;
        const finalName = disambiguate(name, taken.map((t) => t.display_name));
        await tx`update participants
                 set display_name = ${finalName}, last_seen_at = now()
                 where id = ${row.id}`;
        return {
          participantId: row.id,
          displayName: finalName,
          token: existingToken,
          rejoined: true,
        };
      }
    }

    const taken = await tx<{ display_name: string }[]>`
      select display_name from participants where room_id = ${room.id}`;
    const finalName = disambiguate(name, taken.map((t) => t.display_name));

    const token = generateToken();
    const inserted = await tx<{ id: string }[]>`
      insert into participants (room_id, token_hash, display_name)
      values (${room.id}, ${hashToken(token)}, ${finalName})
      returning id`;

    await logEvent(tx, room.id, "participant_joined", {});
    return {
      participantId: inserted[0]!.id,
      displayName: finalName,
      token,
      rejoined: false,
    };
  });
}

/**
 * Opens a new pulse round, closing whichever one was collecting.
 *
 * This replaces the old "reset": erasing every learner's answer destroyed the
 * before half of a before-and-after comparison, which is the main reason to ask
 * twice. A round is the thing that starts empty; the previous one keeps its
 * counts for the rest of the session and in the summary.
 */
export async function startPulseRound(
  room: RoomRow,
  options: { label?: string; sectionId?: string | null } = {},
): Promise<{ id: string; seq: number }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);
    const sectionId = await resolveSection(tx, room, options.sectionId ?? undefined);

    await tx`update pulse_rounds set status = 'closed', closed_at = now()
             where room_id = ${room.id} and status = 'open'`;

    const seqRows = await tx<{ next: number }[]>`
      select coalesce(max(seq), 0) + 1 as next from pulse_rounds where room_id = ${room.id}`;
    const seq = seqRows[0]?.next ?? 1;
    const label = (options.label ?? "").trim().slice(0, 60) || `Round ${seq}`;

    const rows = await tx<{ id: string }[]>`
      insert into pulse_rounds (room_id, section_id, seq, label)
      values (${room.id}, ${sectionId}, ${seq}, ${label})
      returning id`;

    await logEvent(tx, room.id, "pulse_round_started", { seq, sectionId });
    return { id: rows[0]!.id, seq };
  });
}

/**
 * Records one learner's pulse in the round that is collecting.
 *
 * `expectedRoundId` is what the learner's phone believed was open. A tap that
 * was already in flight when the instructor moved on must not land in the new
 * round and quietly claim the class understood something it has not been shown
 * yet, so a mismatch is refused rather than redirected.
 */
export async function setPulse(
  room: RoomRow,
  participantId: string,
  pulse: PulseValue,
  expectedRoundId?: string | null,
): Promise<{ roundId: string }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    // Serialise every write that touches a pulse round for this room.
    //
    // Row locks are not enough here. `pulse_rounds` carries a version trigger,
    // so writing a round is also a write to `rooms` inside the same statement —
    // which means a learner holding the round's share lock while waiting for
    // `rooms`, and an instructor moving the class on, form a cycle whichever
    // order the statements are written in. Postgres detected it as a deadlock
    // the first time a learner tapped at the exact moment the class advanced.
    // One advisory lock removes the cycle instead of shuffling it around; the
    // transactions it serialises are a millisecond each, and they already
    // queued on the `rooms` row anyway.
    await lockRoom(tx, room.id);

    // Participants before rooms, always: setPulse and respondToPoll both touch
    // the room through a version trigger, and taking the two in a different
    // order in one of them is how the same learner deadlocks against themselves.
    const alive = await tx<{ id: string }[]>`
      update participants set last_seen_at = now()
      where id = ${participantId} and room_id = ${room.id}
      returning id`;
    if (alive.length === 0) throw new ApiError("not_found", "You are no longer in this room.");

    let round = (
      await tx<{ id: string }[]>`
        select id from pulse_rounds
        where room_id = ${room.id} and status = 'open'
        order by seq desc limit 1 for share`
    )[0];

    if (!round) {
      // Quick-start: the instructor never opened a round, the class just tapped.
      // Read the section inside the lock. The room row this request loaded can
      // be a navigation behind, and a round opened against a stale section is
      // exactly the mis-attribution closing rounds on navigation prevents.
      const here = (
        await tx<{ current_section_id: string | null }[]>`
          select current_section_id from rooms where id = ${room.id}`
      )[0];
      const seqRows = await tx<{ next: number }[]>`
        select coalesce(max(seq), 0) + 1 as next from pulse_rounds where room_id = ${room.id}`;
      const seq = seqRows[0]?.next ?? 1;
      const created = await tx<{ id: string }[]>`
        insert into pulse_rounds (room_id, section_id, seq, label)
        values (${room.id}, ${here?.current_section_id ?? null}, ${seq}, ${`Round ${seq}`})
        on conflict do nothing
        returning id`;
      round =
        created[0] ??
        (
          await tx<{ id: string }[]>`
            select id from pulse_rounds where room_id = ${room.id} and status = 'open' limit 1`
        )[0];
      if (!round) throw new ApiError("conflict", "The pulse is not open right now.");
    }

    if (expectedRoundId && expectedRoundId !== round.id) {
      throw new ApiError(
        "conflict",
        "The class has moved on to a new pulse. Your last answer was not counted — tap again.",
      );
    }

    await tx`
      insert into pulse_responses (round_id, participant_id, room_id, value)
      values (${round.id}, ${participantId}, ${room.id}, ${pulse})
      on conflict (round_id, participant_id)
      do update set value = excluded.value, updated_at = now()`;

    await logEvent(tx, room.id, "pulse_set", { pulse });
    return { roundId: round.id };
  });
}

/**
 * Ensures the room has a section for something to belong to, and validates any
 * section the caller named actually belongs to this room.
 */
export async function resolveSection(
  tx: Db,
  room: RoomRow,
  sectionId?: string | null,
): Promise<string | null> {
  if (sectionId) {
    const rows = await tx<{ id: string }[]>`
      select id from sections where id = ${sectionId} and room_id = ${room.id}`;
    if (rows[0]) return rows[0].id;
    throw new ApiError("bad_request", "That section is not part of this class.");
  }
  if (room.current_section_id) return room.current_section_id;

  const existing = await tx<{ id: string }[]>`
    select id from sections where room_id = ${room.id} order by position asc limit 1`;
  if (existing[0]) return existing[0].id;
  return null;
}

// ------------------------------------------------------------------- polls

export async function createPoll(room: RoomRow, input: CreatePollInput): Promise<{ id: string }> {
  assertRoomOpen(room);
  const options = buildOptions(input.kind, input.choiceLabels);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);

    const seqRows = await tx<{ next: number }[]>`
      select coalesce(max(seq), 0) + 1 as next from polls where room_id = ${room.id}`;
    const seq = seqRows[0]?.next ?? 1;

    if (input.openNow) await closeOpenPolls(tx, room.id);

    const rows = await tx<{ id: string }[]>`
      insert into polls (room_id, seq, prompt, kind, options, status, opened_at)
      values (${room.id}, ${seq}, ${input.prompt.trim()}, ${input.kind},
              ${sql.json(options as never)},
              ${input.openNow ? "open" : "draft"},
              ${input.openNow ? sql`now()` : null})
      returning id`;

    if (input.openNow) {
      await tx`update rooms set public_mode = 'poll' where id = ${room.id}`;
    }
    await logEvent(tx, room.id, "poll_created", { kind: input.kind, seq });
    return { id: rows[0]!.id };
  });
}

/**
 * Ask a previous question again, as a new round.
 *
 * Reopening the original row would bring its answers and its revealed results
 * with it — the projector would show the pre-break distribution as if it were
 * the new one. A copy starts clean and keeps the old round intact in the
 * session summary.
 */
export async function askAgain(room: RoomRow, pollId: string): Promise<{ id: string }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    await lockRoom(tx, room.id);

    const rows = await tx<{ prompt: string; kind: string; options: unknown }[]>`
      select prompt, kind, options from polls
      where id = ${pollId} and room_id = ${room.id}`;
    const source = rows[0];
    if (!source) throw new ApiError("not_found", "That poll no longer exists.");

    await closeOpenPolls(tx, room.id);

    const seqRows = await tx<{ next: number }[]>`
      select coalesce(max(seq), 0) + 1 as next from polls where room_id = ${room.id}`;

    const created = await tx<{ id: string }[]>`
      insert into polls (room_id, seq, prompt, kind, options, status, opened_at)
      values (${room.id}, ${seqRows[0]?.next ?? 1}, ${source.prompt}, ${source.kind},
              ${sql.json(parsePollOptions(source.options) as never)}, 'open', now())
      returning id`;

    await tx`update rooms set public_mode = 'poll' where id = ${room.id}`;
    await logEvent(tx, room.id, "poll_asked_again", { from: pollId });
    return { id: created[0]!.id };
  });
}

async function closeOpenPolls(tx: Tx, roomId: string): Promise<void> {
  await tx`update polls set status = 'closed', closed_at = now()
           where room_id = ${roomId} and status = 'open'`;
}

export async function actOnPoll(
  room: RoomRow,
  pollId: string,
  action: PollAction,
): Promise<void> {
  assertRoomOpen(room);

  await sql.begin(async (tx) => {
    await lockRoom(tx, room.id);

    const rows = await tx<{ status: "draft" | "open" | "closed"; revealed: boolean }[]>`
      select status, revealed from polls
      where id = ${pollId} and room_id = ${room.id}
      for update`;
    const current = rows[0];
    if (!current) throw new ApiError("not_found", "That poll no longer exists.");

    const result = transition(current, action);
    // Reopening to collect more answers must not leave the old distribution on
    // the projector; the instructor reveals again when they are ready.
    if (result.ok && result.next && action === "open") result.next.revealed = false;
    if (!result.ok || !result.next) {
      throw new ApiError("conflict", result.reason ?? "That poll action is not available.");
    }

    // Only one poll may collect answers at a time, so opening one closes the rest.
    if (action === "open") await closeOpenPolls(tx, room.id);

    await tx`
      update polls
      set status = ${result.next.status},
          revealed = ${result.next.revealed},
          opened_at = case when ${action === "open"} then now() else opened_at end,
          -- Reopening clears the old close time; existing answers are kept on
          -- purpose, since it is the same question being put to the room again.
          closed_at = case
                        when ${action === "close"} then now()
                        when ${action === "open"} then null
                        else closed_at
                      end
      where id = ${pollId}`;

    // Keep the projector in step with the instructor's most recent intent.
    if (action === "open" || action === "reveal") {
      const nextMode = action === "open" ? "poll" : "results";
      await tx`update rooms set public_mode = ${nextMode} where id = ${room.id}`;
    } else if (action === "hide" && room.public_mode === "results") {
      await tx`update rooms set public_mode = 'poll' where id = ${room.id}`;
    }

    await logEvent(tx, room.id, `poll_${action}`, { pollId });
  });
}

/**
 * Record a learner's answer.
 *
 * The (poll_id, participant_id) primary key is the one-answer rule; an upsert
 * lets a learner change their mind while the poll is open. The status is
 * re-read inside the transaction so a poll that closes mid-tap rejects the
 * answer rather than racing it in.
 */
export async function respondToPoll(
  room: RoomRow,
  pollId: string,
  participantId: string,
  value: string,
): Promise<{ value: string }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    const rows = await tx<{ status: "draft" | "open" | "closed"; options: unknown }[]>`
      select status, options from polls
        where id = ${pollId} and room_id = ${room.id}
        for share`;
    const poll = rows[0];
    if (!poll) throw new ApiError("not_found", "That question is no longer available.");
    if (poll.status !== "open") {
      throw new ApiError("conflict", "This poll is closed. Your answer was not recorded.");
    }
    if (!isValidResponse(parsePollOptions(poll.options), value)) {
      throw new ApiError("bad_request", "That is not one of the available answers.");
    }

    // Lock order matters. Writing the response touches `rooms` (via the version
    // trigger), so the participant row must be taken BEFORE that, not after:
    // setPulse and clearPulses both go participants -> rooms, and the reverse
    // order here would let a learner answering a poll deadlock against the same
    // learner changing their pulse a moment later.
    await tx`update participants set last_seen_at = now() where id = ${participantId}`;

    await tx`
      insert into poll_responses (poll_id, participant_id, room_id, value)
      values (${pollId}, ${participantId}, ${room.id}, ${value})
      on conflict (poll_id, participant_id)
      do update set value = excluded.value, updated_at = now()`;

    return { value };
  });
}

// --------------------------------------------------------------- questions

/**
 * Records a question, with the context the learner was in when they asked.
 *
 * The section and activity are written once and never rewritten, so moving the
 * class on cannot relabel what somebody asked twenty minutes ago. A context
 * that does not belong to this room — a phone a version behind during a section
 * change — is dropped to "general" rather than rejected: losing the question
 * would be worse than losing its label.
 */
export async function submitQuestion(
  room: RoomRow,
  participantId: string,
  body: string,
  anonymous: boolean,
  context: { sectionId?: string | null; activityId?: string | null } = {},
): Promise<{ id: string }> {
  assertRoomOpen(room);
  const text = body.trim();
  if (text.length < 2) throw new ApiError("bad_request", "Please write a question first.");

  const [section, activity] = await Promise.all([
    context.sectionId
      ? sql<{ id: string }[]>`
          select id from sections where id = ${context.sectionId} and room_id = ${room.id}`
      : Promise.resolve([] as { id: string }[]),
    context.activityId
      ? sql<{ id: string; section_id: string | null }[]>`
          select id, section_id from activities
          where id = ${context.activityId} and room_id = ${room.id}`
      : Promise.resolve([] as { id: string; section_id: string | null }[]),
  ]);

  const activityId = activity[0]?.id ?? null;
  const sectionId = section[0]?.id ?? activity[0]?.section_id ?? null;

  const rows = await sql<{ id: string }[]>`
    insert into questions (room_id, participant_id, body, is_anonymous, section_id, activity_id)
    values (${room.id}, ${participantId}, ${text}, ${anonymous}, ${sectionId}, ${activityId})
    returning id`;
  await logEvent(sql, room.id, "question_submitted", { anonymous, sectionId, activityId });
  return { id: rows[0]!.id };
}

/**
 * Toggle one learner's upvote.
 *
 * The (question_id, participant_id) primary key means repeated tapping can only
 * ever add or remove that learner's single vote — it cannot inflate the count.
 */
export async function toggleQuestionVote(
  room: RoomRow,
  questionId: string,
  participantId: string,
): Promise<{ voted: boolean }> {
  assertRoomOpen(room);

  return sql.begin(async (tx) => {
    // The primary key already makes it impossible to inflate the count, but the
    // toggle is a read-modify-write: without this lock a retried or double tap
    // can interleave delete-then-insert and leave the learner voted when they
    // meant to un-vote. The lock is per (question, learner), so it never
    // contends between different learners.
    await tx`select pg_advisory_xact_lock(
      hashtextextended(${`${questionId}:${participantId}`}, 0))`;

    const exists = await tx<{ id: string }[]>`
      select id from questions
      where id = ${questionId} and room_id = ${room.id} and status <> 'hidden'`;
    if (exists.length === 0) throw new ApiError("not_found", "That question is no longer listed.");

    const removed = await tx`
      delete from question_votes
      where question_id = ${questionId} and participant_id = ${participantId}
      returning question_id`;
    if (removed.length > 0) return { voted: false };

    await tx`
      insert into question_votes (question_id, participant_id, room_id)
      values (${questionId}, ${participantId}, ${room.id})`;
    return { voted: true };
  });
}

export async function actOnQuestion(
  room: RoomRow,
  questionId: string,
  action: "answer" | "reopen" | "hide",
): Promise<void> {
  const status = action === "answer" ? "answered" : action === "hide" ? "hidden" : "open";
  const updated = await sql`
    update questions
    set status = ${status},
        answered_at = ${action === "answer" ? sql`now()` : null}
    where id = ${questionId} and room_id = ${room.id}
    returning id`;
  if (updated.length === 0) throw new ApiError("not_found", "That question no longer exists.");
  await logEvent(sql, room.id, `question_${action}`, { questionId });
}

// ------------------------------------------------------------------ picker

export async function pickParticipant(
  room: RoomRow,
): Promise<{ id: string; displayName: string }> {
  assertRoomOpen(room);
  const seconds = PRESENCE_WINDOW_MS / 1000;

  return sql.begin(async (tx) => {
    const candidates = await tx<{ id: string; display_name: string }[]>`
      select id, display_name from participants
      where room_id = ${room.id}
        and last_seen_at > now() - make_interval(secs => ${seconds})
      order by joined_at`;

    const history = await tx<{ participant_id: string | null }[]>`
      select participant_id from picks where room_id = ${room.id} order by created_at asc`;

    const outcome = choosePick(
      {
        candidates: candidates.map((c) => ({ id: c.id, displayName: c.display_name })),
        history: history.map((h) => h.participant_id).filter((id): id is string => id !== null),
      },
      randomChoice,
    );

    if (!outcome.ok) throw new ApiError("conflict", outcome.reason);

    const rows = await tx<{ id: string }[]>`
      insert into picks (room_id, participant_id, display_name)
      values (${room.id}, ${outcome.picked.id}, ${outcome.picked.displayName})
      returning id`;

    await tx`update rooms set public_mode = 'pick' where id = ${room.id}`;
    await logEvent(tx, room.id, "participant_picked", { pool: outcome.pool });

    return { id: rows[0]!.id, displayName: outcome.picked.displayName };
  });
}
