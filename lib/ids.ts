import { randomBytes, createHash, timingSafeEqual, randomInt } from "node:crypto";
import { CODE_ALPHABET, CODE_LENGTH } from "./room-code";

export { CODE_ALPHABET, CODE_LENGTH, normalizeRoomCode, isPlausibleRoomCode } from "./room-code";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Random opaque bearer token (host or participant). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented token against a stored hex digest. */
export function tokenMatches(token: string, expectedHash: string): boolean {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Uniform random element, used by the participant picker. */
export function randomChoice<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[randomInt(items.length)];
}
