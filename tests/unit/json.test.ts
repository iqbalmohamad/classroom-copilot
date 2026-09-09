import { describe, expect, it } from "vitest";
import { parsePollOptions } from "@/lib/domain/json";

describe("poll option parsing", () => {
  it("passes through a well-formed array", () => {
    const options = [{ value: "yes", label: "Yes" }];
    expect(parsePollOptions(options)).toEqual(options);
  });

  it("recovers a double-encoded jsonb value rather than crashing the room", () => {
    const options = [{ value: "yes", label: "Yes" }];
    expect(parsePollOptions(JSON.stringify(options))).toEqual(options);
  });

  it("returns an empty ballot for anything unusable", () => {
    expect(parsePollOptions(null)).toEqual([]);
    expect(parsePollOptions("not json")).toEqual([]);
    expect(parsePollOptions({ value: "yes" })).toEqual([]);
  });

  it("drops malformed entries but keeps the good ones", () => {
    expect(parsePollOptions([{ value: "yes", label: "Yes" }, { value: 1 }, null])).toEqual([
      { value: "yes", label: "Yes" },
    ]);
  });
});
