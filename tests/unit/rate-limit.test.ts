import { beforeEach, describe, expect, it } from "vitest";
import { allow, LIMITS, resetLimits } from "@/lib/rate-limit";

describe("rate limiting", () => {
  beforeEach(() => resetLimits());

  it("allows a normal burst", () => {
    for (let i = 0; i < LIMITS.question.capacity; i += 1) {
      expect(allow("learner-1", LIMITS.question, 1000)).toBe(true);
    }
  });

  it("stops a flood once the bucket is empty", () => {
    for (let i = 0; i < LIMITS.question.capacity; i += 1) {
      allow("learner-1", LIMITS.question, 1000);
    }
    expect(allow("learner-1", LIMITS.question, 1000)).toBe(false);
  });

  it("refills over time", () => {
    for (let i = 0; i < LIMITS.question.capacity; i += 1) {
      allow("learner-1", LIMITS.question, 1000);
    }
    expect(allow("learner-1", LIMITS.question, 1000)).toBe(false);
    // One token per ten seconds at the configured refill rate.
    expect(allow("learner-1", LIMITS.question, 1000 + 11_000)).toBe(true);
  });

  it("keeps buckets separate per caller", () => {
    for (let i = 0; i < LIMITS.question.capacity; i += 1) {
      allow("learner-1", LIMITS.question, 1000);
    }
    expect(allow("learner-1", LIMITS.question, 1000)).toBe(false);
    expect(allow("learner-2", LIMITS.question, 1000)).toBe(true);
  });

  it("is generous enough not to interrupt normal poll answering", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(allow("learner-1", LIMITS.respond, 1000 + i * 500)).toBe(true);
    }
  });
});
