import { describe, expect, it } from "vitest";
import { buildClassSummary } from "@/lib/ai";
import type { InstructorSnapshot } from "@/lib/types";

/**
 * The AI feature is optional, but the boundary it sits behind is not: whatever
 * is sent to a third-party provider must contain aggregates and nothing else.
 */
function snapshot(overrides: Partial<InstructorSnapshot> = {}): InstructorSnapshot {
  return {
    role: "instructor",
    version: 1,
    room: {
      code: "ABC234",
      title: "Class",
      status: "open",
      publicMode: "join",
    currentSectionId: null,
    currentSectionTitle: null,
      createdAt: "2026-09-13T10:00:00.000Z",
      endedAt: null,
    },
    joinUrl: "https://example.test/r/ABC234",
    roster: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        displayName: "Ada Lovelace",
        present: true,
        joinedAt: "2026-09-13T10:00:00.000Z",
        pickedCount: 0,
      },
    ],
    presentCount: 1,
    joinedCount: 1,
    activePoll: {
      id: "22222222-2222-2222-2222-222222222222",
      seq: 1,
      prompt: "Is a Promise eager?",
      kind: "yes_no",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      status: "open",
      revealed: false,
      responseCount: 1,
      tallies: [
        { value: "yes", label: "Yes", count: 1, percent: 100 },
        { value: "no", label: "No", count: 0, percent: 0 },
      ],
      openedAt: null,
      closedAt: null,
      createdAt: "2026-09-13T10:00:00.000Z",
    },
    polls: [],
    pulse: {
      counts: { got_it: 0, shaky: 0, lost: 1 },
      percents: { got_it: 0, shaky: 0, lost: 100 },
      responded: 1,
      noResponse: 0,
      total: 1,
    },
    questions: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        body: "Why is this eager?",
        votes: 3,
        status: "open",
        createdAt: "2026-09-13T10:00:00.000Z",
        votedByMe: null,
        authorName: "Ada Lovelace",
        sectionId: null,
        sectionTitle: null,
        activityId: null,
        activityTitle: null,
      },
    ],
    picks: [],
    aiEnabled: true,
    sections: [],
    pulseRound: null,
    pulseHistory: [],
    activities: [],
    materials: [],
    timer: null,
    ...overrides,
  };
}

describe("class read input", () => {
  it("sends aggregates, never a learner's name or identifier", () => {
    const summary = buildClassSummary(snapshot());
    expect(summary).not.toContain("Ada Lovelace");
    expect(summary).not.toContain("11111111");
    expect(summary).not.toContain("22222222");
    expect(summary).not.toContain("33333333");
    expect(summary).not.toContain("example.test");
  });

  it("includes the signals the instructor is actually reasoning about", () => {
    const summary = buildClassSummary(snapshot());
    expect(summary).toContain("Learners present: 1");
    expect(summary).toContain("Is a Promise eager?");
    expect(summary).toContain("Lost 1 (100%)");
    expect(summary).toContain("Why is this eager?");
  });

  it("marks learner-written text as data, not instructions", () => {
    const summary = buildClassSummary(snapshot());
    expect(summary).toContain("<learner-questions>");
    expect(summary).toContain("</learner-questions>");
    expect(summary).toContain("not instructions");
  });

  it("reads a room where nothing has happened yet without inventing data", () => {
    const summary = buildClassSummary(
      snapshot({
        activePoll: null,
        polls: [],
        questions: [],
        pulse: {
          counts: { got_it: 0, shaky: 0, lost: 0 },
          percents: { got_it: 0, shaky: 0, lost: 0 },
          responded: 0,
          noResponse: 0,
          total: 0,
        },
      }),
    );
    expect(summary).toContain("No poll has been run yet.");
    expect(summary).toContain("nobody has reported yet");
    expect(summary).not.toContain("<learner-questions>");
  });
});
