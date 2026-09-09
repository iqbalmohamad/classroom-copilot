import type { PollView, PublicMode } from "../types";

/**
 * What the presentation screen is showing, described for the instructor.
 *
 * The console and the projector are two different browser tabs, and the
 * instructor cannot see the second one while they are sharing it. Everything
 * here exists so the console can state what is on that screen without the
 * instructor having to look — including the cases where the mode they chose has
 * nothing to display and the screen has quietly fallen back to the join code.
 *
 * Kept in step with `publicSnapshot` in lib/projections.ts and `Stage` in
 * app/r/[code]/screen/PublicView.tsx, which are what actually decide.
 */

/** Instructor-facing names for the five screens. */
export const SCREEN_LABELS: Record<PublicMode, string> = {
  join: "Join code & QR",
  poll: "Poll question",
  results: "Poll results",
  activity: "Activity prompt",
  response: "Selected response",
  pick: "Selected participant",
  waiting: "Waiting screen",
};

export const SCREEN_ORDER: PublicMode[] = [
  "join",
  "poll",
  "results",
  "activity",
  "response",
  "pick",
  "waiting",
];

export interface ScreenContext {
  /** Every poll in the room, in any order. */
  polls: PollView[];
  /** Whether anyone has been picked yet. */
  hasPick: boolean;
  /** Whether the class has ended. */
  ended: boolean;
  /** Whether any activity has been put in front of the class. */
  hasActivity?: boolean;
  /** Whether the instructor has a response on the screen right now. */
  hasRevealedResponse?: boolean;
}

/**
 * The poll the projector would use.
 *
 * The public snapshot takes the most recently started poll that has been
 * opened at least once — not the poll the instructor is currently editing, and
 * not necessarily the highest-numbered one, since reopening an earlier question
 * puts it back in front of the class.
 */
export function projectedPoll(polls: PollView[]): PollView | null {
  const started = polls.filter((poll) => poll.status !== "draft");
  if (started.length === 0) return null;

  const startedAt = (poll: PollView) => poll.openedAt ?? poll.createdAt;
  return started.reduce((latest, poll) =>
    startedAt(poll) > startedAt(latest) ? poll : latest,
  );
}

/**
 * The class is looking at a question whose results the instructor has not
 * revealed. Neither "Poll question" nor "Poll results" describes that honestly:
 * the question is up, and the results are deliberately not.
 */
export const HIDDEN_RESULTS_LABEL = "Question — results hidden";

/** After the class ends the screen shows a closing message, whatever the mode. */
export const ENDED_LABEL = "Class ended";

export interface ScreenState {
  /**
   * What the presentation screen is actually showing — not which screen is
   * selected. The two differ whenever the chosen screen has no content, and the
   * instructor is looking at the console precisely because they cannot check.
   */
  label: string;
  /** Why the selection and the screen differ, short enough to scan. */
  reason: string | null;
  /** What to do about it, where there is something specific to do. */
  action: string | null;
}

/**
 * What the class can see, given the instructor's selection and the room.
 *
 * Mirrors `Stage` in app/r/[code]/screen/PublicView.tsx branch for branch: a
 * mode with nothing behind it falls through to the join screen there, so it
 * must read as the join screen here too.
 */
export function describeScreen(mode: PublicMode, context: ScreenContext): ScreenState {
  const settled = (label: string): ScreenState => ({ label, reason: null, action: null });

  if (context.ended) return settled(ENDED_LABEL);

  const poll = projectedPoll(context.polls);
  const fallback = (reason: string): ScreenState => ({
    label: SCREEN_LABELS.join,
    reason,
    action: null,
  });
  const noPollYet = "No question has been shown yet.";

  switch (mode) {
    case "poll":
      return poll ? settled(SCREEN_LABELS.poll) : fallback(noPollYet);

    case "results":
      if (!poll) return fallback(noPollYet);
      // Selecting this screen does not reveal anything, so say what the class
      // is left looking at and how to change that.
      return poll.revealed
        ? settled(SCREEN_LABELS.results)
        : {
            label: HIDDEN_RESULTS_LABEL,
            reason: "The class can see the question, not the split.",
            action: "Use \u201cShow results on screen\u201d under Ask the class to reveal them.",
          };

    case "activity":
      return context.hasActivity
        ? settled(SCREEN_LABELS.activity)
        : fallback("No activity has been opened yet.");

    case "response":
      // Selecting this screen shows nothing on its own: a response reaches the
      // projector only when the instructor reveals that specific one.
      return context.hasRevealedResponse
        ? settled(SCREEN_LABELS.response)
        : fallback("No response has been put on the screen yet.");

    case "pick":
      return context.hasPick
        ? settled(SCREEN_LABELS.pick)
        : fallback("No one has been picked yet.");

    case "waiting":
      return settled(SCREEN_LABELS.waiting);

    default:
      return settled(SCREEN_LABELS.join);
  }
}
