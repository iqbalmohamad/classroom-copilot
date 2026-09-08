import "server-only";
import { findRoom, resolveHost, resolveParticipant, type ParticipantRow, type RoomRow } from "./auth";
import { ApiError } from "./http";
import { normalizeRoomCode } from "./room-code";

/**
 * Every room route starts here.
 *
 * `requireHost` and `requireParticipant` are the only two ways to obtain
 * authority in this application, and they read from different cookies against
 * different stored digests. There is no path from a learner token to an
 * instructor capability.
 */

export async function loadRoom(codeParam: string): Promise<RoomRow> {
  const code = normalizeRoomCode(codeParam);
  const room = await findRoom(code);
  if (!room) throw new ApiError("not_found", "That class code was not found.");
  return room;
}

export async function requireHost(req: Request, room: RoomRow): Promise<void> {
  const isHost = await resolveHost(req, room);
  if (!isHost) {
    throw new ApiError("forbidden", "Only the instructor who created this class can do that.");
  }
}

export async function requireParticipant(
  req: Request,
  room: RoomRow,
): Promise<ParticipantRow> {
  const participant = await resolveParticipant(req, room);
  if (!participant) {
    throw new ApiError("unauthorized", "Join the class again to continue.");
  }
  return participant;
}

/** Stable per-caller key for rate limiting. Never logged, never stored. */
export function clientKey(req: Request, scope: string): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}
