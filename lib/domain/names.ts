/**
 * Display-name handling for learners.
 *
 * Names are typed on a phone in a hurry, so we normalise whitespace, cap the
 * length, and strip control, zero-width and bidi-override characters that would
 * otherwise let a name break the roster layout on the instructor's screen or on
 * the projector.
 */
export const MAX_NAME_LENGTH = 40;

const UNSAFE_CHARS = new RegExp(
  "[" +
    "\\u0000-\\u001f\\u007f-\\u009f" + // C0 / C1 control characters
    "\\u200b-\\u200f" + // zero width + LTR/RTL marks
    "\\u202a-\\u202e" + // bidi embedding / override
    "\\u2066-\\u2069" + // bidi isolates
    "\\ufeff" + // zero-width no-break space
    "]",
  "g",
);

export function normalizeDisplayName(input: string): string {
  return (
    input
      // Whitespace-like controls (newline, tab) become a space so a pasted
      // "Ada\nLovelace" reads as two words rather than one run-on.
      .replace(/\s+/g, " ")
      // Everything else in the unsafe set is removed outright.
      .replace(UNSAFE_CHARS, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH)
      .trim()
  );
}

export function isValidDisplayName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH;
}

/**
 * Two learners often type the same first name. The instructor needs to tell
 * them apart in the roster and, more importantly, when one of them is picked.
 */
export function disambiguate(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;

  const stem = name.slice(0, MAX_NAME_LENGTH - 6).trim();
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem} (${suffix})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}
