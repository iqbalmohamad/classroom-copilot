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

/**
 * Stable per-caller key for rate limiting. Never logged, never stored.
 *
 * X-Forwarded-For is a client-supplied header that proxies *append* to, so its
 * leftmost entry is whatever the caller put there — reading that would let
 * anyone rotate through fake addresses and bypass every limit. Prefer the
 * platform's own single-value header, and fall back to the rightmost (closest,
 * proxy-written) X-Forwarded-For entry rather than the leftmost.
 */
export function clientKey(req: Request, scope: string): string {
  const platform =
    req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip") ?? "";

  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const hops = forwarded
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  const ip = platform.trim() || hops[hops.length - 1] || "local";
  return `${scope}:${ip}`;
}
