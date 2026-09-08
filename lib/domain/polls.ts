import type { PollKind, PollOption, PollStatus, PollTally } from "../types";

export const YES_NO_OPTIONS: PollOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

export const CONFIDENCE_OPTIONS: PollOption[] = [
  { value: "1", label: "1 — Not at all" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5 — Completely" },
];

/**
 * Builds the canonical option set for a poll kind.
 *
 * Multiple choice always uses the letters A–D; `labels` optionally supplies
 * instructor-written text for each letter. Empty labels fall back to the letter
 * itself so a poll can be launched with two keystrokes mid-lesson.
 */
export function buildOptions(kind: PollKind, labels?: (string | undefined)[]): PollOption[] {
  switch (kind) {
    case "yes_no":
      return YES_NO_OPTIONS.map((o) => ({ ...o }));
    case "confidence":
      return CONFIDENCE_OPTIONS.map((o) => ({ ...o }));
    case "multiple_choice": {
      const count = clampChoiceCount(labels?.length ?? 4);
      return CHOICE_LETTERS.slice(0, count).map((letter, i) => {
        const custom = labels?.[i]?.trim();
        return { value: letter, label: custom ? `${letter}. ${custom}` : letter };
      });
    }
  }
}

function clampChoiceCount(requested: number): number {
  if (!Number.isFinite(requested)) return 4;
  return Math.min(CHOICE_LETTERS.length, Math.max(2, Math.trunc(requested)));
}

export function isValidResponse(options: PollOption[], value: string): boolean {
  return options.some((option) => option.value === value);
}

/**
 * Turns raw per-option counts into an ordered tally with integer percentages.
 *
 * Percentages are rounded independently; they are a classroom readout, not an
 * accounting total, so they are allowed to sum to 99 or 101.
 */
export function tally(options: PollOption[], counts: Record<string, number>): PollTally[] {
  const total = options.reduce((sum, option) => sum + (counts[option.value] ?? 0), 0);
  return options.map((option) => {
    const count = counts[option.value] ?? 0;
    return {
      value: option.value,
      label: option.label,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
}

export interface PollTransitionState {
  status: PollStatus;
  revealed: boolean;
}

export type PollAction = "open" | "close" | "reveal" | "hide";

export interface TransitionResult {
  ok: boolean;
  next?: PollTransitionState;
  reason?: string;
}

/**
 * The poll state machine.
 *
 *   draft ──open──> open ──close──> closed ──open──> open   (reopen is allowed:
 *   closing by accident mid-class must be recoverable)
 *
 * `revealed` is orthogonal to status so an instructor can show a live
 * distribution while the poll is still collecting answers.
 */
export function transition(
  current: PollTransitionState,
  action: PollAction,
): TransitionResult {
  switch (action) {
    case "open":
      if (current.status === "open") return { ok: false, reason: "Poll is already open." };
      return { ok: true, next: { status: "open", revealed: current.revealed } };
    case "close":
      if (current.status !== "open") return { ok: false, reason: "Poll is not open." };
      return { ok: true, next: { status: "closed", revealed: current.revealed } };
    case "reveal":
      if (current.status === "draft") return { ok: false, reason: "Open the poll first." };
      return { ok: true, next: { status: current.status, revealed: true } };
    case "hide":
      return { ok: true, next: { status: current.status, revealed: false } };
  }
}

/** A closed or draft poll never accepts answers — this is the rule tests pin. */
export function acceptsResponses(status: PollStatus): boolean {
  return status === "open";
}

/** Learner/public surfaces only ever see aggregates once the instructor reveals. */
export function tallyVisibleTo(role: "instructor" | "learner" | "public", revealed: boolean) {
  return role === "instructor" ? true : revealed;
}
