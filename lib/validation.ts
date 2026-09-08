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
});

export const questionActionSchema = z.object({
  action: z.enum(["answer", "reopen", "hide"]),
});

export const publicModeSchema = z.object({
  mode: z.enum(["join", "poll", "results", "pick", "waiting"]),
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
