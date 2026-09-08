import { describe, expect, it } from "vitest";
import { choosePick, type PickCandidate } from "@/lib/domain/picker";

const people: PickCandidate[] = [
  { id: "a", displayName: "Ada" },
  { id: "b", displayName: "Grace" },
  { id: "c", displayName: "Alan" },
];

/** Deterministic stand-in for the crypto random source. */
const first = <T,>(items: readonly T[]): T | undefined => items[0];
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

describe("participant picker", () => {
  it("declines gracefully when the room is empty", () => {
    const result = choosePick({ candidates: [], history: [] }, first);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/No learners/);
  });

  it("draws from learners who have not been picked yet", () => {
    const result = choosePick({ candidates: people, history: ["a"] }, first);
    expect(result).toMatchObject({ ok: true, pool: "fresh" });
    if (result.ok) expect(result.picked.id).toBe("b");
  });

  it("recycles the pool only once everyone has had a turn", () => {
    const result = choosePick({ candidates: people, history: ["a", "b", "c"] }, first);
    expect(result).toMatchObject({ ok: true, pool: "recycled" });
  });

  it("never picks the same learner twice in a row after recycling", () => {
    // "c" was picked last, so it must be excluded even though `last` would
    // otherwise select it.
    const result = choosePick({ candidates: people, history: ["a", "b", "c"] }, last);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.picked.id).not.toBe("c");
  });

  it("keeps picking the only learner present rather than failing", () => {
    const solo = [people[0]!];
    const result = choosePick({ candidates: solo, history: ["a", "a", "a"] }, first);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.picked.id).toBe("a");
  });

  it("ignores history entries for learners who have left", () => {
    const result = choosePick({ candidates: people, history: ["gone", "also-gone"] }, first);
    expect(result).toMatchObject({ ok: true, pool: "fresh" });
  });

  it("covers everyone exactly once across a full round", () => {
    const history: string[] = [];
    const seen: string[] = [];
    for (let i = 0; i < people.length; i += 1) {
      const result = choosePick({ candidates: people, history }, first);
      if (!result.ok) throw new Error("expected a pick");
      seen.push(result.picked.id);
      history.push(result.picked.id);
    }
    expect([...seen].sort()).toEqual(["a", "b", "c"]);
  });
});
