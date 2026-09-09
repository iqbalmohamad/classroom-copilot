/**
 * Participant picker.
 *
 * Deliberately simple and deliberately not AI: a uniform random draw with two
 * fairness rules that matter in a real classroom.
 *
 *   1. Learners who have not been picked yet this session are drawn first.
 *      This is what stops the same three confident students being asked
 *      every time.
 *   2. Once everyone has had a turn the pool resets, but the most recent pick
 *      is excluded so nobody is called twice in a row — unless they are the
 *      only person in the room.
 *
 * The random source is injected so the behaviour can be pinned by tests.
 */

export interface PickCandidate {
  id: string;
  displayName: string;
}

export interface PickInput {
  /** Present participants, in any order. */
  candidates: readonly PickCandidate[];
  /** Participant ids already picked this session, most recent last. */
  history: readonly string[];
}

export type PickOutcome =
  | { ok: true; picked: PickCandidate; pool: "fresh" | "recycled" }
  | { ok: false; reason: string };

const EMPTY_ROSTER = "No learners are in the room yet.";

export function choosePick(
  input: PickInput,
  choose: <T>(items: readonly T[]) => T | undefined,
): PickOutcome {
  const { candidates, history } = input;

  if (candidates.length === 0) {
    return { ok: false, reason: EMPTY_ROSTER };
  }

  const pickedIds = new Set(history);
  const unpicked = candidates.filter((c) => !pickedIds.has(c.id));

  if (unpicked.length > 0) {
    const picked = choose(unpicked);
    return picked ? { ok: true, picked, pool: "fresh" } : { ok: false, reason: EMPTY_ROSTER };
  }

  // Everyone has had a turn: recycle the pool, but never pick twice in a row.
  const lastPicked = history[history.length - 1];
  const eligible =
    candidates.length > 1 ? candidates.filter((c) => c.id !== lastPicked) : candidates;

  const picked = choose(eligible.length > 0 ? eligible : candidates);
  return picked ? { ok: true, picked, pool: "recycled" } : { ok: false, reason: EMPTY_ROSTER };
}
