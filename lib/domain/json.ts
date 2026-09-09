import type { PollOption } from "../types";

/**
 * Poll options come back from Postgres as a parsed jsonb value. This guard
 * keeps a malformed or double-encoded row from taking a live classroom down:
 * the worst case becomes a poll with no options rather than a 500 on every
 * request that touches the room.
 */
export function parsePollOptions(raw: unknown): PollOption[] {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PollOption =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as PollOption).value === "string" &&
      typeof (item as PollOption).label === "string",
  );
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
