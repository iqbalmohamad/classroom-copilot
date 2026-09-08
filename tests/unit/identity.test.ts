import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isPlausibleRoomCode,
  normalizeRoomCode,
} from "@/lib/room-code";
import { disambiguate, normalizeDisplayName, isValidDisplayName } from "@/lib/domain/names";
import { generateRoomCode, generateToken, hashToken, tokenMatches } from "@/lib/ids";

describe("room codes", () => {
  it("excludes glyphs that are easy to misread aloud or on a projector", () => {
    for (const ambiguous of ["I", "L", "O", "0", "1"]) {
      expect(CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("generates codes of the expected shape", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isPlausibleRoomCode(code)).toBe(true);
    }
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 500 }, generateRoomCode));
    expect(codes.size).toBeGreaterThan(495);
  });

  it("forgives case, spaces and dashes in what a learner types", () => {
    expect(normalizeRoomCode(" ab c-23 ")).toBe("ABC23");
    expect(normalizeRoomCode("k7qp4m")).toBe("K7QP4M");
  });

  it("does not silently rewrite characters into a different code", () => {
    expect(normalizeRoomCode("ABC234")).toBe("ABC234");
    expect(isPlausibleRoomCode(normalizeRoomCode("ABCI34"))).toBe(false);
  });
});

describe("tokens", () => {
  it("issues long random tokens", () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(new Set(Array.from({ length: 200 }, generateToken)).size).toBe(200);
  });

  it("matches only the exact token", () => {
    const token = generateToken();
    const digest = hashToken(token);
    expect(tokenMatches(token, digest)).toBe(true);
    expect(tokenMatches(`${token}x`, digest)).toBe(false);
    expect(tokenMatches("", digest)).toBe(false);
    expect(tokenMatches(token, "")).toBe(false);
  });

  it("stores a digest, never the token itself", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("survives a malformed stored digest without throwing", () => {
    const token = generateToken();
    expect(() => tokenMatches(token, "not-hex")).not.toThrow();
    expect(tokenMatches(token, "not-hex")).toBe(false);
  });
});

describe("display names", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeDisplayName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
  });

  it("strips control, zero-width and bidi characters that would break the roster", () => {
    expect(normalizeDisplayName("Ada\u202eevil")).toBe("Adaevil");
    expect(normalizeDisplayName("Ada\u0007")).toBe("Ada");
    expect(normalizeDisplayName("Ada\u200bLove")).toBe("AdaLove");
    expect(normalizeDisplayName("Ada\nLovelace")).toBe("Ada Lovelace");
  });

  it("caps the length", () => {
    expect(normalizeDisplayName("x".repeat(200))).toHaveLength(40);
  });

  it("rejects an empty name", () => {
    expect(isValidDisplayName(normalizeDisplayName("   "))).toBe(false);
    expect(isValidDisplayName(normalizeDisplayName("\u200b"))).toBe(false);
  });

  it("keeps two learners with the same name apart", () => {
    expect(disambiguate("Sam", [])).toBe("Sam");
    expect(disambiguate("Sam", ["Sam"])).toBe("Sam (2)");
    expect(disambiguate("Sam", ["Sam", "Sam (2)"])).toBe("Sam (3)");
    expect(disambiguate("sam", ["SAM"])).toBe("sam (2)");
  });

  it("keeps a disambiguated name within the column limit", () => {
    const long = "x".repeat(40);
    expect(disambiguate(long, [long]).length).toBeLessThanOrEqual(40);
  });
});
