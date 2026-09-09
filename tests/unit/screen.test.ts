import { describe, expect, it } from "vitest";
import { SCREEN_LABELS, projectedPoll, screenNote } from "@/lib/domain/screen";
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

describe("what the console tells the instructor", () => {
  it("says nothing when the chosen screen has its content", () => {
    const open = poll({ id: "p", status: "open", revealed: true, openedAt: "2026-09-13T09:00:00Z" });
    expect(screenNote("join", context([]))).toBeNull();
    expect(screenNote("waiting", context([]))).toBeNull();
    expect(screenNote("poll", context([open]))).toBeNull();
    expect(screenNote("results", context([open]))).toBeNull();
    expect(screenNote("pick", context([], { hasPick: true }))).toBeNull();
  });

  it("explains the fallback to the join code when there is nothing to show", () => {
    expect(screenNote("poll", context([]))).toEqual({
      reason: "No question has been shown yet.",
      instead: "The screen is showing the join code.",
    });
    expect(screenNote("results", context([]))?.instead).toMatch(/join code/);
    expect(screenNote("pick", context([]))?.reason).toMatch(/No one has been picked/);
  });

  it("says results are held back rather than pretending the screen is empty", () => {
    // Choosing the results screen must not read as "results are up". The class
    // sees the question until the instructor reveals.
    const hidden = poll({ id: "p", status: "closed", revealed: false });
    const note = screenNote("results", context([hidden]))!;
    expect(note.reason).toMatch(/hidden until you show them/);
    // ...and it points at the control that does reveal them, rather than
    // leaving the instructor hunting for it mid-lesson.
    expect(note.instead).toMatch(/Show results on screen/);
  });

  it("says the same thing for every screen once the class has ended", () => {
    for (const mode of ["join", "poll", "results", "pick", "waiting"] as const) {
      expect(screenNote(mode, context([], { ended: true }))?.reason).toMatch(/class has ended/);
    }
  });

  it("labels the five screens the way the instructor is told to expect", () => {
    expect(SCREEN_LABELS).toEqual({
      join: "Join code & QR",
      poll: "Poll question",
      results: "Poll results",
      pick: "Selected participant",
      waiting: "Waiting screen",
    });
  });
});
