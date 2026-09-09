import { z } from "zod";
import { CODE_LENGTH } from "./room-code";
import { MAX_NAME_LENGTH } from "./domain/names";

/**
 * Every mutation body is parsed here before it reaches the database. Nothing
 * that arrives from a browser is trusted, including requests from the
 * instructor's own console.
 */

export const roomCodeSchema = z
  .string()
  .trim()
  .min(CODE_LENGTH)
  .max(16);

export const createRoomSchema = z.object({
  title: z.string().trim().max(80).optional(),
  /**
   * Start from a saved plan. The token is what proves the caller may read it —
   * a plan id alone opens nothing, for the same reason a room code alone grants
   * no instructor powers.
   */
  planId: z.string().uuid().optional(),
  planToken: z.string().min(10).max(200).optional(),
});

export const joinRoomSchema = z.object({
  displayName: z.string().min(1).max(MAX_NAME_LENGTH * 2),
});

export const createPollSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
  kind: z.enum(["yes_no", "multiple_choice", "confidence"]),
  choiceLabels: z.array(z.string().max(120)).max(4).optional(),
  openNow: z.boolean().optional(),
});

export const pollActionSchema = z.object({
  action: z.enum(["open", "close", "reveal", "hide"]),
});

export const respondSchema = z.object({
  value: z.string().min(1).max(40),
});

export const pulseSchema = z.object({
  pulse: z.enum(["got_it", "shaky", "lost"]),
});

export const questionSchema = z.object({
  body: z.string().trim().min(2).max(500),
  anonymous: z.boolean().optional(),
  /**
   * Where the learner says they are asking from. Verified against the room
   * server-side; anything that does not belong to it is treated as "general"
   * rather than rejected, so a phone one version behind still gets its question
   * in during a section change.
   */
  sectionId: z.string().uuid().nullish(),
  activityId: z.string().uuid().nullish(),
});

export const questionActionSchema = z.object({
  action: z.enum(["answer", "reopen", "hide"]),
});

export const publicModeSchema = z.object({
  mode: z.enum(["join", "poll", "results", "pick", "waiting", "activity", "response"]),
});

// ------------------------------------------------------------------ sections

export const createSectionSchema = z.object({
  title: z.string().trim().max(80).optional(),
  /** Insert after this section rather than at the end. */
  afterId: z.string().uuid().nullish(),
});

export const renameSectionSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export const reorderSectionsSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(40),
});

export const selectSectionSchema = z.object({
  /** Omit to advance to the next section, creating one if there is none. */
  sectionId: z.string().uuid().nullish(),
});

// -------------------------------------------------------------- pulse rounds

export const startPulseRoundSchema = z.object({
  label: z.string().trim().max(60).optional(),
  sectionId: z.string().uuid().nullish(),
});

export const pulseResponseSchema = z.object({
  pulse: z.enum(["got_it", "shaky", "lost"]),
  /**
   * Which round the learner believes they are answering. A submission naming a
   * round that is no longer collecting is rejected rather than silently landing
   * in the next one.
   */
  roundId: z.string().uuid().nullish(),
});

// --------------------------------------------------------------- activities

const activityFieldSchema = z.object({
  label: z.string().trim().max(120).optional(),
  type: z.enum(["short_text", "number", "long_text", "sql", "choice"]).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  choices: z.array(z.string().max(120)).max(6).optional(),
});

export const createActivitySchema = z.object({
  /** Optional only when the activity is lifted from a plan, which brings its own. */
  title: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(2000).optional(),
  fields: z.array(activityFieldSchema).max(8).optional(),
  sectionId: z.string().uuid().nullish(),
  referenceAnswer: z.string().trim().max(4000).optional(),
  durationSeconds: z.number().int().min(10).max(36000).nullish(),
  openNow: z.boolean().optional(),
  /** Reuse a prepared exercise from a saved plan instead of typing a new one. */
  fromPlan: z
    .object({ planId: z.string().uuid(), token: z.string().min(10).max(200), key: z.string().max(80) })
    .optional(),
});

export const updateActivitySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().trim().max(2000).nullish(),
  fields: z.array(activityFieldSchema).max(8).optional(),
  sectionId: z.string().uuid().nullish(),
  referenceAnswer: z.string().trim().max(4000).nullish(),
  durationSeconds: z.number().int().min(10).max(36000).nullish(),
});

export const activityActionSchema = z.object({
  action: z.enum(["open", "close", "again", "delete"]),
});

export const submitActivitySchema = z.object({
  answers: z.record(z.string().max(40), z.string().max(4000)),
});

export const reviewResponseSchema = z.object({
  reviewState: z.enum(["pending", "reviewed", "needs_follow_up"]).optional(),
  feedback: z.string().trim().max(2000).nullish(),
  reveal: z.boolean().optional(),
  /** Naming the author on the shared screen is always an explicit choice. */
  revealAuthor: z.boolean().optional(),
  /** Put the response's author in the spotlight and record it in pick history. */
  invite: z.boolean().optional(),
});

// ------------------------------------------------------------------- timers

export const startTimerSchema = z.object({
  durationSeconds: z.number().int().min(10).max(36000),
  label: z.string().trim().max(60).optional(),
  activityId: z.string().uuid().nullish(),
  autoClose: z.boolean().optional(),
});

export const timerActionSchema = z.object({
  action: z.enum(["pause", "resume", "extend", "end"]),
  /** Only for `extend`. */
  seconds: z.number().int().min(10).max(3600).optional(),
});

// ---------------------------------------------------------------- materials

export const createMaterialSchema = z.object({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
  note: z.string().trim().max(300).optional(),
  sectionId: z.string().uuid().nullish(),
  highlighted: z.boolean().optional(),
});

export const updateMaterialSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2000).optional(),
  note: z.string().trim().max(300).nullish(),
  sectionId: z.string().uuid().nullish(),
  highlighted: z.boolean().optional(),
});

// ------------------------------------------------------------ session plans

export const savePlanSchema = z.object({
  title: z.string().trim().max(120).optional(),
});

export const planTokenSchema = z.object({
  token: z.string().min(10).max(200),
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
export type StartTimerInput = z.infer<typeof startTimerSchema>;
export type ReviewResponseInput = z.infer<typeof reviewResponseSchema>;
