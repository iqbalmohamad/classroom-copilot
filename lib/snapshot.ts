import "server-only";
import type { RoomRow } from "./auth";
import { touchParticipant } from "./auth";
import { requireHost, requireParticipant } from "./route-context";
import { instructorSnapshot, learnerSnapshot, publicSnapshot } from "./projections";
import { requestOrigin } from "./origin";
import type { Role, Snapshot } from "./types";

/**
 * Resolves the caller's authority for `role` and returns the matching snapshot.
 *
 * Both the polling endpoint and the event stream go through here, so a surface
 * cannot obtain a projection it is not entitled to by choosing a different
 * transport.
 */
export async function buildSnapshot(
  req: Request,
  room: RoomRow,
  role: Role,
  options: { heartbeat?: boolean } = {},
): Promise<Snapshot> {
  const origin = requestOrigin(req);

  if (role === "instructor") {
    await requireHost(req, room);
    return instructorSnapshot(room, origin);
  }

  if (role === "learner") {
    const participant = await requireParticipant(req, room);
    // The learner's own reads double as their presence heartbeat, so a phone
    // with the app open never falls off the roster.
    if (options.heartbeat) await touchParticipant(participant.id);
    return learnerSnapshot(room, participant.id);
  }

  return publicSnapshot(room, origin);
}
