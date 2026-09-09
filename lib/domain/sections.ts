/**
 * Section ordering.
 *
 * Sections are optional: a room always has one so that everything else has
 * somewhere to belong, but an instructor who never opens the planner simply
 * teaches inside "Section 1" and never sees the word again.
 */

export const MAX_SECTIONS = 40;

export function autoSectionTitle(position: number): string {
  return `Section ${position}`;
}

/**
 * Validates a requested order against what the room actually has.
 *
 * A reorder is only accepted as a complete permutation. Accepting a partial
 * list would leave positions to be inferred, and inferring them is how a
 * half-applied reorder ends up interleaving a prepared plan with itself.
 */
export function permutationOf(current: readonly string[], requested: readonly string[]): string[] | null {
  if (requested.length !== current.length) return null;
  const have = new Set(current);
  const seen = new Set<string>();
  for (const id of requested) {
    if (!have.has(id) || seen.has(id)) return null;
    seen.add(id);
  }
  return [...requested];
}
