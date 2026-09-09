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
  pick: "Selected participant",
  waiting: "Waiting screen",
};

export const SCREEN_ORDER: PublicMode[] = ["join", "poll", "results", "pick", "waiting"];

export interface ScreenContext {
  /** Every poll in the room, in any order. */
  polls: PollView[];
  /** Whether anyone has been picked yet. */
  hasPick: boolean;
  /** Whether the class has ended. */
  ended: boolean;
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

export interface ScreenNote {
  /** Why this screen has nothing of its own to put up. */
  reason: string;
  /** What the class is looking at instead. */
  instead: string;
}

/**
 * Why the chosen screen is not showing what its name suggests, or null when it
 * is. Written for someone mid-lesson: the reason on its own is enough when
 * scanning the options, and the pair together says what the class can see right
 * now, which is the thing the instructor cannot check for themselves.
 */
export function screenNote(mode: PublicMode, context: ScreenContext): ScreenNote | null {
  if (context.ended) {
    return {
      reason: "The class has ended.",
      instead: "The screen shows a closing message.",
    };
  }

  const poll = projectedPoll(context.polls);
  const noPollYet = {
    reason: "No question has been shown yet.",
    instead: "The screen is showing the join code.",
  };

  switch (mode) {
    case "poll":
      return poll ? null : noPollYet;
    case "results":
      if (!poll) return noPollYet;
      // Choosing this screen never reveals a hidden result: the class sees the
      // question and a "results coming up" line until the instructor reveals.
      return poll.revealed
        ? null
        : {
            reason: "Results stay hidden until you show them.",
            instead:
              "The screen keeps the question up until you use \u201cShow results on screen\u201d " +
              "under Ask the class.",
          };
    case "pick":
      return context.hasPick
        ? null
        : {
            reason: "No one has been picked yet.",
            instead: "The screen is showing the join code.",
          };
    default:
      return null;
  }
}
