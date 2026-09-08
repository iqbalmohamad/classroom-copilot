/**
 * Room-code helpers shared by server and browser.
 *
 * Kept separate from lib/ids.ts so that client components can normalise a typed
 * code without pulling node:crypto into the browser bundle.
 */

/** No I, L, O, 0 or 1: a code read off a projector must be hard to mistype. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/**
 * Canonicalises whatever the learner typed or pasted.
 *
 * Only case and separators are normalised. The alphabet already excludes the
 * ambiguous glyphs, so remapping characters here could only turn a valid code
 * into an invalid one.
 */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isPlausibleRoomCode(code: string): boolean {
  return (
    code.length === CODE_LENGTH && code.split("").every((ch) => CODE_ALPHABET.includes(ch))
  );
}
