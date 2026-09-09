import { describe, expect, it } from "vitest";
import { linkLabel, safeHttpUrl } from "@/lib/domain/links";
import { csvCell, csvDocument } from "@/lib/domain/csv";
import { clampDuration, formatCountdown, hasExpired, secondsRemaining } from "@/lib/domain/timers";
import { permutationOf } from "@/lib/domain/sections";

describe("material links", () => {
  it("accepts the links a deck actually contains", () => {
    expect(safeHttpUrl("https://www.postgresql.org/download/")).toBe(
      "https://www.postgresql.org/download/",
    );
    expect(safeHttpUrl("http://localhost:8080/guide")).toBe("http://localhost:8080/guide");
    // People paste a bare host; assume https rather than refusing.
    expect(safeHttpUrl("dbeaver.io/download/")).toBe("https://dbeaver.io/download/");
  });

  it("refuses anything that could run in a learner's browser", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "",
      "   ",
    ]) {
      expect(safeHttpUrl(url), url).toBeNull();
    }
  });

  it("refuses credentials in the URL, which are a phishing shape", () => {
    expect(safeHttpUrl("https://user:pass@example.test/guide")).toBeNull();
  });

  it("shortens a link for a phone", () => {
    expect(linkLabel("https://www.postgresql.org/download/")).toBe("www.postgresql.org/download/");
    expect(linkLabel("not a url")).toBe("not a url");
  });
});

describe("csv export", () => {
  it("quotes and escapes so an answer survives the round trip", () => {
    expect(csvCell('He said "order_items", then left')).toBe(
      '"He said ""order_items"", then left"',
    );
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("defuses everything a spreadsheet would run as a formula", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(csvCell(`${lead}CMD()`).startsWith(`"'${lead}`), lead).toBe(true);
    }
    // A leading minus is the common one: SQL comments start with two of them.
    expect(csvCell("-- a comment")).toBe(`"'-- a comment"`);
  });

  it("leaves ordinary text alone apart from quoting", () => {
    expect(csvCell("order_items")).toBe('"order_items"');
    expect(csvCell(null)).toBe('""');
  });

  it("writes a document Excel opens as UTF-8", () => {
    const doc = csvDocument([["a", "b"], ["c", "d"]]);
    expect(doc.startsWith("﻿")).toBe(true);
    expect(doc).toContain('"a","b"\r\n"c","d"');
  });
});

describe("timers", () => {
  const base = {
    id: "t",
    label: "Activity",
    durationSeconds: 300,
    autoClose: true,
    expired: false,
    activityId: null,
  };

  it("counts down from the stored deadline", () => {
    const now = Date.UTC(2026, 8, 13, 10, 0, 0);
    const timer = {
      ...base,
      status: "running" as const,
      endsAt: new Date(now + 90_000).toISOString(),
      remainingSeconds: null,
    };
    expect(secondsRemaining(timer, now)).toBe(90);
    // Never negative: "how long ago it ran out" is not a classroom countdown.
    expect(secondsRemaining(timer, now + 200_000)).toBe(0);
  });

  it("holds what was left while paused", () => {
    const timer = { ...base, status: "paused" as const, endsAt: null, remainingSeconds: 42 };
    expect(secondsRemaining(timer, Date.now())).toBe(42);
    expect(hasExpired(timer, Date.now() + 10_000_000)).toBe(false);
  });

  it("knows when a running timer is past its deadline", () => {
    const now = Date.now();
    const timer = {
      ...base,
      status: "running" as const,
      endsAt: new Date(now - 1).toISOString(),
      remainingSeconds: null,
    };
    expect(hasExpired(timer, now)).toBe(true);
  });

  it("formats and clamps for a classroom", () => {
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(clampDuration(1)).toBe(10);
    expect(clampDuration(99_999)).toBe(36_000);
    expect(clampDuration(Number.NaN)).toBe(300);
  });
});

describe("section reordering", () => {
  it("accepts a complete permutation", () => {
    expect(permutationOf(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("refuses anything partial, duplicated or foreign", () => {
    // Half-applying a reorder interleaves a prepared plan with itself.
    expect(permutationOf(["a", "b", "c"], ["a", "b"])).toBeNull();
    expect(permutationOf(["a", "b"], ["a", "a"])).toBeNull();
    expect(permutationOf(["a", "b"], ["a", "z"])).toBeNull();
  });
});
