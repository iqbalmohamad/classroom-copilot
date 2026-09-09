import "server-only";
import { sql } from "./db";
import { ApiError } from "./http";
import type { RoomRow } from "./auth";
import { generateToken, hashToken, tokenMatches } from "./ids";
import { parseFields, type ActivityField } from "./domain/activities";
import { parsePollOptions } from "./domain/json";
import { safeHttpUrl } from "./domain/links";
import type { PollKind, PollOption } from "./types";

/**
 * Reusable session plans.
 *
 * The product has no accounts and this must not introduce one, so a plan is
 * owned by a bearer token handed to the instructor once and stored only as a
 * digest — the same shape as a room's host token, for the same reason: an id
 * alone opens nothing.
 *
 * A plan holds only what an instructor wrote: section order, exercises, polls,
 * durations, materials, private reference answers. It cannot hold anything a
 * learner produced, because the queries that build it never read those tables.
 * Creating a room from a plan therefore cannot carry a name, a submission, a
 * piece of feedback, a pulse, a vote or a pick into the new session.
 */

export interface PlanActivity {
  key: string;
  sectionKey: string | null;
  title: string;
  instructions: string | null;
  fields: ActivityField[];
  referenceAnswer: string | null;
  durationSeconds: number | null;
}

export interface PlanPoll {
  key: string;
  sectionKey: string | null;
  prompt: string;
  kind: PollKind;
  options: PollOption[];
}

export interface PlanMaterial {
  key: string;
  sectionKey: string | null;
  title: string;
  url: string;
  note: string | null;
  highlighted: boolean;
}

export interface PlanPayload {
  sections: { key: string; title: string }[];
  activities: PlanActivity[];
  polls: PlanPoll[];
  materials: PlanMaterial[];
}

export interface PlanRecord {
  id: string;
  title: string;
  createdAt: string;
  payload: PlanPayload;
}

function emptyPlan(): PlanPayload {
  return { sections: [], activities: [], polls: [], materials: [] };
}

/** Recovers a stored plan without trusting the jsonb shape. */
export function parsePlanPayload(raw: unknown): PlanPayload {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyPlan();
    }
  }
  if (!value || typeof value !== "object") return emptyPlan();
  const record = value as Record<string, unknown>;
  const plan = emptyPlan();

  if (Array.isArray(record.sections)) {
    for (const entry of record.sections) {
      const row = entry as { key?: unknown; title?: unknown };
      if (typeof row?.key === "string" && typeof row?.title === "string") {
        plan.sections.push({ key: row.key, title: row.title });
      }
    }
  }
  if (Array.isArray(record.activities)) {
    for (const entry of record.activities) {
      const row = entry as Record<string, unknown>;
      if (typeof row?.key !== "string" || typeof row?.title !== "string") continue;
      plan.activities.push({
        key: row.key,
        sectionKey: typeof row.sectionKey === "string" ? row.sectionKey : null,
        title: row.title,
        instructions: typeof row.instructions === "string" ? row.instructions : null,
        fields: parseFields(row.fields),
        referenceAnswer: typeof row.referenceAnswer === "string" ? row.referenceAnswer : null,
        durationSeconds:
          typeof row.durationSeconds === "number" ? row.durationSeconds : null,
      });
    }
  }
  if (Array.isArray(record.polls)) {
    for (const entry of record.polls) {
      const row = entry as Record<string, unknown>;
      if (typeof row?.key !== "string" || typeof row?.prompt !== "string") continue;
      const kind = row.kind;
      if (kind !== "yes_no" && kind !== "multiple_choice" && kind !== "confidence") continue;
      plan.polls.push({
        key: row.key,
        sectionKey: typeof row.sectionKey === "string" ? row.sectionKey : null,
        prompt: row.prompt,
        kind,
        options: parsePollOptions(row.options),
      });
    }
  }
  if (Array.isArray(record.materials)) {
    for (const entry of record.materials) {
      const row = entry as Record<string, unknown>;
      if (typeof row?.key !== "string" || typeof row?.title !== "string") continue;
      const url = typeof row.url === "string" ? safeHttpUrl(row.url) : null;
      if (!url) continue;
      plan.materials.push({
        key: row.key,
        sectionKey: typeof row.sectionKey === "string" ? row.sectionKey : null,
        title: row.title,
        url,
        note: typeof row.note === "string" ? row.note : null,
        highlighted: row.highlighted === true,
      });
    }
  }
  return plan;
}

/**
 * Snapshots the prepared parts of a room.
 *
 * Note what is not selected here: participants, activity_responses, feedback,
 * pulse_rounds, pulse_responses, poll_responses, question_votes, picks. The
 * separation is structural rather than a filter applied afterwards, so a plan
 * cannot come to carry learner data by someone later adding a column.
 */
export async function savePlan(
  room: RoomRow,
  title: string | undefined,
): Promise<{ id: string; token: string; title: string }> {
  const [sections, activities, polls, materials] = await Promise.all([
    sql<{ id: string; title: string }[]>`
      select id, title from sections where room_id = ${room.id} order by position asc`,
    sql<
      {
        id: string;
        section_id: string | null;
        title: string;
        instructions: string | null;
        fields: unknown;
        reference_answer: string | null;
        duration_seconds: number | null;
      }[]
    >`
      select id, section_id, title, instructions, fields, reference_answer, duration_seconds
      from activities where room_id = ${room.id} order by seq asc`,
    sql<
      { id: string; section_id: string | null; prompt: string; kind: PollKind; options: unknown }[]
    >`
      select p.id, null::uuid as section_id, p.prompt, p.kind, p.options
      from polls p where p.room_id = ${room.id} order by p.seq asc`,
    sql<
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
      from materials where room_id = ${room.id} order by position asc`,
  ]);

  const payload: PlanPayload = {
    sections: sections.map((section) => ({ key: section.id, title: section.title })),
    activities: activities.map((activity) => ({
      key: activity.id,
      sectionKey: activity.section_id,
      title: activity.title,
      instructions: activity.instructions,
      fields: parseFields(activity.fields),
      referenceAnswer: activity.reference_answer,
      durationSeconds: activity.duration_seconds,
    })),
    polls: polls.map((poll) => ({
      key: poll.id,
      sectionKey: poll.section_id,
      prompt: poll.prompt,
      kind: poll.kind,
      options: parsePollOptions(poll.options),
    })),
    materials: materials.map((material) => ({
      key: material.id,
      sectionKey: material.section_id,
      title: material.title,
      url: material.url,
      note: material.note,
      highlighted: material.highlighted,
    })),
  };

  const token = generateToken();
  const planTitle = (title ?? "").trim().slice(0, 120) || `${room.title} — plan`;
  const rows = await sql<{ id: string }[]>`
    insert into session_plans (token_hash, title, payload, source_room_id)
    values (${hashToken(token)}, ${planTitle}, ${sql.json(payload as never)}, ${room.id})
    returning id`;

  return { id: rows[0]!.id, token, title: planTitle };
}

/** Reads a plan, but only for a caller holding its token. */
export async function loadPlan(planId: string, token: string): Promise<PlanRecord> {
  const rows = await sql<
    { id: string; token_hash: string; title: string; payload: unknown; created_at: Date }[]
  >`select id, token_hash, title, payload, created_at from session_plans where id = ${planId}`;
  const plan = rows[0];
  // Same answer for "no such plan" and "wrong token", so the endpoint cannot be
  // used to discover which plan ids exist.
  if (!plan || !tokenMatches(token, plan.token_hash)) {
    throw new ApiError("not_found", "That plan was not found.");
  }
  return {
    id: plan.id,
    title: plan.title,
    createdAt: plan.created_at.toISOString(),
    payload: parsePlanPayload(plan.payload),
  };
}

/**
 * Seeds a brand-new room from a plan.
 *
 * Everything arrives unpublished: activities and polls land as drafts, so
 * opening the room from a plan cannot put a question in front of a class before
 * the instructor has said a word.
 */
export async function applyPlanToRoom(room: RoomRow, plan: PlanPayload): Promise<void> {
  await sql.begin(async (tx) => {
    const sectionIds = new Map<string, string>();

    if (plan.sections.length > 0) {
      // The room was created with its own "Section 1"; the plan's order replaces
      // it rather than being appended after it.
      await tx`update rooms set current_section_id = null where id = ${room.id}`;
      await tx`delete from sections where room_id = ${room.id}`;

      for (const [index, section] of plan.sections.entries()) {
        const rows = await tx<{ id: string }[]>`
          insert into sections (room_id, position, title)
          values (${room.id}, ${index + 1}, ${section.title})
          returning id`;
        sectionIds.set(section.key, rows[0]!.id);
      }
      const first = sectionIds.get(plan.sections[0]!.key)!;
      await tx`update rooms set current_section_id = ${first} where id = ${room.id}`;
    }

    let seq = 0;
    for (const activity of plan.activities) {
      seq += 1;
      await tx`
        insert into activities
          (room_id, section_id, seq, title, instructions, fields, status, reference_answer,
           duration_seconds)
        values (${room.id}, ${activity.sectionKey ? sectionIds.get(activity.sectionKey) ?? null : null},
                ${seq}, ${activity.title}, ${activity.instructions},
                ${sql.json(activity.fields as never)}, 'draft', ${activity.referenceAnswer},
                ${activity.durationSeconds})`;
    }

    let pollSeq = 0;
    for (const poll of plan.polls) {
      pollSeq += 1;
      await tx`
        insert into polls (room_id, seq, prompt, kind, options, status)
        values (${room.id}, ${pollSeq}, ${poll.prompt}, ${poll.kind},
                ${sql.json(poll.options as never)}, 'draft')`;
    }

    let position = 0;
    for (const material of plan.materials) {
      position += 1;
      await tx`
        insert into materials (room_id, section_id, position, title, url, note, highlighted)
        values (${room.id}, ${material.sectionKey ? sectionIds.get(material.sectionKey) ?? null : null},
                ${position}, ${material.title}, ${material.url}, ${material.note},
                ${material.highlighted})`;
    }

    await tx`insert into session_events (room_id, kind, payload)
             values (${room.id}, 'room_seeded_from_plan',
                     ${sql.json({ sections: plan.sections.length,
                                  activities: plan.activities.length } as never)})`;
  });
}

/** One prepared exercise from a plan, for reusing it on its own. */
export function findPlanActivity(plan: PlanPayload, key: string): PlanActivity | null {
  return plan.activities.find((activity) => activity.key === key) ?? null;
}
