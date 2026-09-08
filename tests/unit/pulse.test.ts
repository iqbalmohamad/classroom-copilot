import { describe, expect, it } from "vitest";
import { isPulseValue, summarisePulse } from "@/lib/domain/pulse";

describe("class pulse aggregation", () => {
  it("is empty when nobody has responded", () => {
    const summary = summarisePulse([null, null]);
    expect(summary.responded).toBe(0);
    expect(summary.noResponse).toBe(2);
    expect(summary.percents).toEqual({ got_it: 0, shaky: 0, lost: 0 });
  });

  it("counts one signal per learner", () => {
    const summary = summarisePulse(["got_it", "got_it", "lost", null]);
    expect(summary.counts).toEqual({ got_it: 2, shaky: 0, lost: 1 });
    expect(summary.responded).toBe(3);
    expect(summary.noResponse).toBe(1);
    expect(summary.total).toBe(4);
  });

  it("takes percentages of those who responded, not of the whole room", () => {
    const summary = summarisePulse(["got_it", "lost", null, null]);
    expect(summary.percents.got_it).toBe(50);
    expect(summary.percents.lost).toBe(50);
  });

  it("recognises only the three defined states", () => {
    expect(isPulseValue("got_it")).toBe(true);
    expect(isPulseValue("shaky")).toBe(true);
    expect(isPulseValue("lost")).toBe(true);
    expect(isPulseValue("confused")).toBe(false);
    expect(isPulseValue(null)).toBe(false);
  });
});
