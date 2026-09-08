import { PRESENCE_WINDOW_MS } from "../types";

/**
 * Presence is derived from the last heartbeat rather than stored, so a learner
 * whose phone sleeps or whose network drops simply fades out of the roster and
 * comes back the moment their client reconnects. No disconnect bookkeeping, and
 * no state that can get stuck after a server restart.
 */
export function isPresent(lastSeenAt: Date | string, now: Date = new Date()): boolean {
  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  const delta = now.getTime() - seen.getTime();
  return Number.isFinite(delta) && delta >= -PRESENCE_WINDOW_MS && delta <= PRESENCE_WINDOW_MS;
}
