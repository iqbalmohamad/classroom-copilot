import { describe, expect, it } from "vitest";
import {
  ENDED_LABEL,
  HIDDEN_RESULTS_LABEL,
  SCREEN_LABELS,
  describeScreen,
  projectedPoll,
} from "@/lib/domain/screen";
import type { PollView } from "@/lib/types";

const poll = (over: Partial<PollView> & { id: string }): PollView => ({
  seq: 1,
  prompt: "Is a Promise eager?",
  kind: "yes_no",
  options: [],
  status: "open",
  revealed: false,
  responseCount: 0,
  tallies: null,
  openedAt: null,
  closedAt: null,
  createdAt: "2026-09-13T09:00:00.000Z",
  ...over,
});

const context = (polls: PollView[], over: { hasPick?: boolean; ended?: boolean } = {}) => ({
  polls,
  hasPick: over.hasPick ?? false,
  ended: over.ended ?? false,
});

describe("which poll the class is looking at", () => {
  it("ignores a draft the instructor is still writing", () => {
    const drafted = poll({ id: "draft", status: "draft" });
    expect(projectedPoll([drafted])).toBeNull();
  });

  it("takes the most recently started poll, not the highest numbered one", () => {
    // Reopening an earlier question puts it back in front of the class, so seq
    // order is the wrong answer here — the projector orders by start time.
    const older = poll({
      id: "older",
      seq: 1,
      status: "open",
      openedAt: "2026-09-13T09:30:00.000Z",
    });
    const newer = poll({
      id: "newer",
      seq: 2,
      status: "closed",
      openedAt: "2026-09-13T09:10:00.000Z",
    });
    expect(projectedPoll([newer, older])?.id).toBe("older");
  });

  it("falls back to creation time for a poll that was never opened", () => {
    const closed = poll({ id: "closed", status: "closed", createdAt: "2026-09-13T09:05:00.000Z" });
    expect(projectedPoll([closed])?.id).toBe("closed");
  });
});

describe("what the console reports as showing", () => {
  const open = (over: Partial<PollView> = {}) =>
    poll({ id: "p", status: "open", openedAt: "2026-09-13T09:00:00.000Z", ...over });

  it("names the content, not the selection, when the two differ", () => {
    // The whole point of the status line is that the instructor cannot see the
    // tab they are sharing. Echoing their own click back at them would report
    // "Poll results" while the room looks at a join code.
    expect(describeScreen("results", context([])).label).toBe("Join code & QR");
    expect(describeScreen("poll", context([])).label).toBe("Join code & QR");
    expect(describeScreen("pick", context([])).label).toBe("Join code & QR");
  });

  it("names the content when the selection does have it", () => {
    expect(describeScreen("join", context([])).label).toBe("Join code & QR");
    expect(describeScreen("waiting", context([])).label).toBe("Waiting screen");
    expect(describeScreen("poll", context([open()])).label).toBe("Poll question");
    expect(describeScreen("results", context([open({ revealed: true })])).label).toBe(
      "Poll results",
    );
    expect(describeScreen("pick", context([], { hasPick: true })).label).toBe(
      "Selected participant",
    );
  });

  it("distinguishes a question with hidden results from both other states", () => {
    const state = describeScreen("results", context([open()]));
    expect(state.label).toBe(HIDDEN_RESULTS_LABEL);
    // Not "Poll results" — nothing is on screen — and not "Poll question"
    // either, because the instructor has asked for results and needs to know
    // they are being withheld rather than that their click did nothing.
    expect(state.label).not.toBe("Poll results");
    expect(state.label).not.toBe("Poll question");
    expect(state.reason).toBe("The class can see the question, not the split.");
    expect(state.action).toMatch(/Show results on screen/);
  });

  it("says the class has ended, whatever screen was selected", () => {
    for (const mode of ["join", "poll", "results", "pick", "waiting"] as const) {
      const state = describeScreen(mode, context([open()], { ended: true }));
      expect(state.label).toBe(ENDED_LABEL);
      expect(state.action).toBeNull();
    }
  });

  it("gives a scannable reason for a selection with nothing behind it", () => {
    expect(describeScreen("poll", context([])).reason).toBe("No question has been shown yet.");
    expect(describeScreen("results", context([])).reason).toBe("No question has been shown yet.");
    expect(describeScreen("pick", context([])).reason).toBe("No one has been picked yet.");
  });

  it("says nothing extra once the chosen screen is the one up", () => {
    for (const state of [
      describeScreen("join", context([])),
      describeScreen("waiting", context([])),
      describeScreen("poll", context([open()])),
      describeScreen("results", context([open({ revealed: true })])),
      describeScreen("pick", context([], { hasPick: true })),
    ]) {
      expect(state.reason).toBeNull();
      expect(state.action).toBeNull();
    }
  });

  it("labels every screen the way the instructor is told to expect", () => {
    expect(SCREEN_LABELS).toEqual({
      join: "Join code & QR",
      poll: "Poll question",
      results: "Poll results",
      activity: "Activity prompt",
      response: "Selected response",
      pick: "Selected participant",
      waiting: "Waiting screen",
    });
  });

  it("explains an activity or response screen with nothing behind it", () => {
    expect(describeScreen("activity", context([])).label).toBe("Join code & QR");
    expect(describeScreen("activity", context([])).reason).toMatch(/No activity/);
    expect(describeScreen("response", context([])).reason).toMatch(/No response/);

    const withActivity = { ...context([]), hasActivity: true, hasRevealedResponse: true };
    expect(describeScreen("activity", withActivity).label).toBe("Activity prompt");
    expect(describeScreen("response", withActivity).label).toBe("Selected response");
  });
});
