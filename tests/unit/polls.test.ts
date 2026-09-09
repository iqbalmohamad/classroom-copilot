import { describe, expect, it } from "vitest";
import {
  acceptsResponses,
  buildOptions,
  isValidResponse,
  tally,
  tallyVisibleTo,
  transition,
} from "@/lib/domain/polls";

describe("poll options", () => {
  it("builds yes/no", () => {
    expect(buildOptions("yes_no").map((o) => o.value)).toEqual(["yes", "no"]);
  });

  it("builds a 1-5 confidence scale with anchored ends", () => {
    const options = buildOptions("confidence");
    expect(options.map((o) => o.value)).toEqual(["1", "2", "3", "4", "5"]);
    expect(options[0]?.label).toContain("1");
    expect(options[4]?.label).toContain("5");
  });

  it("builds A-D and falls back to bare letters when no labels are given", () => {
    expect(buildOptions("multiple_choice").map((o) => o.label)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps instructor labels alongside the letters", () => {
    const options = buildOptions("multiple_choice", ["Array", "", "Map", undefined]);
    expect(options.map((o) => o.label)).toEqual(["A. Array", "B", "C. Map", "D"]);
  });

  it("never builds more than four choices or fewer than two", () => {
    expect(buildOptions("multiple_choice", ["a", "b", "c", "d"])).toHaveLength(4);
    expect(buildOptions("multiple_choice", ["a"])).toHaveLength(2);
  });

  it("only accepts an answer that is on the ballot", () => {
    const options = buildOptions("yes_no");
    expect(isValidResponse(options, "yes")).toBe(true);
    expect(isValidResponse(options, "maybe")).toBe(false);
    expect(isValidResponse(options, "")).toBe(false);
    expect(isValidResponse(options, "YES")).toBe(false);
  });
});

describe("tallies", () => {
  it("reports zero for every option when nobody has answered", () => {
    const result = tally(buildOptions("yes_no"), {});
    expect(result.map((t) => t.count)).toEqual([0, 0]);
    expect(result.map((t) => t.percent)).toEqual([0, 0]);
  });

  it("computes percentages of the answers received", () => {
    const result = tally(buildOptions("yes_no"), { yes: 3, no: 1 });
    expect(result.find((t) => t.value === "yes")).toMatchObject({ count: 3, percent: 75 });
    expect(result.find((t) => t.value === "no")).toMatchObject({ count: 1, percent: 25 });
  });

  it("ignores counts for options that are not on the ballot", () => {
    const result = tally(buildOptions("yes_no"), { yes: 1, maybe: 99 });
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.value === "yes")?.percent).toBe(100);
  });
});

describe("poll state machine", () => {
  it("opens a draft", () => {
    expect(transition({ status: "draft", revealed: false }, "open")).toMatchObject({
      ok: true,
      next: { status: "open" },
    });
  });

  it("refuses to open a poll that is already open", () => {
    expect(transition({ status: "open", revealed: false }, "open").ok).toBe(false);
  });

  it("refuses to close a poll that was never opened", () => {
    expect(transition({ status: "draft", revealed: false }, "close").ok).toBe(false);
  });

  it("allows reopening a closed poll, because closing by mistake happens", () => {
    expect(transition({ status: "closed", revealed: true }, "open")).toMatchObject({
      ok: true,
      next: { status: "open", revealed: true },
    });
  });

  it("keeps reveal independent of open/closed", () => {
    expect(transition({ status: "open", revealed: false }, "reveal").next).toEqual({
      status: "open",
      revealed: true,
    });
    expect(transition({ status: "closed", revealed: true }, "hide").next).toEqual({
      status: "closed",
      revealed: false,
    });
  });

  it("will not reveal a poll that has never been open", () => {
    expect(transition({ status: "draft", revealed: false }, "reveal").ok).toBe(false);
  });

  it("only accepts responses while open", () => {
    expect(acceptsResponses("open")).toBe(true);
    expect(acceptsResponses("closed")).toBe(false);
    expect(acceptsResponses("draft")).toBe(false);
  });
});

describe("who may see aggregates", () => {
  it("always shows the instructor the live distribution", () => {
    expect(tallyVisibleTo("instructor", false)).toBe(true);
  });

  it("hides aggregates from learners and the shared screen until revealed", () => {
    expect(tallyVisibleTo("learner", false)).toBe(false);
    expect(tallyVisibleTo("public", false)).toBe(false);
    expect(tallyVisibleTo("learner", true)).toBe(true);
    expect(tallyVisibleTo("public", true)).toBe(true);
  });
});
