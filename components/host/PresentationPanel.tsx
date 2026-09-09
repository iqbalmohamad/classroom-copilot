"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { PollView, PublicMode } from "@/lib/types";
import { SCREEN_LABELS, SCREEN_ORDER, describeScreen } from "@/lib/domain/screen";
import type { HostAction } from "./types";

/**
 * One panel for the presentation screen: the tab, and what is on it.
 *
 * These used to be two controls in two places — a link in the page header and a
 * row of buttons further down the right column — and instructors did not
 * connect them. The question they actually have mid-lesson is "what are they
 * looking at right now", and that has to be answerable without alt-tabbing to
 * the shared tab, because the shared tab is the one they cannot see.
 *
 * So: the button that opens it, a line of guidance, and the current state, all
 * visible at once. Choosing a different screen by hand is the rarer act — most
 * transitions happen on their own — so it sits behind a disclosure while the
 * state and the open button stay on show.
 */
export function PresentationPanel({
  code,
  publicMode,
  polls,
  hasPick,
  ended,
  disabled,
  act,
}: {
  code: string;
  publicMode: PublicMode;
  polls: PollView[];
  hasPick: boolean;
  ended: boolean;
  disabled: boolean;
  act: HostAction;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const hintId = useId();

  const context = { polls, hasPick, ended };
  const showing = describeScreen(publicMode, context);

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Presentation screen
      </div>

      <Link className="btn btn-primary" href={`/r/${code}/screen`} target="_blank">
        Open presentation screen ↗
      </Link>

      <p className="tiny muted" style={{ margin: 0 }}>
        Share this presentation tab with your class. Control what it shows from here.
      </p>

      {/* The class's view, not the instructor's selection. Naming the chosen
          screen here would have the console confidently report "Poll results"
          while the room looks at a join code. */}
      <div className="screen-status" role="status">
        <span className="screen-status-label">Currently showing</span>
        <span className="screen-status-value">{showing.label}</span>
        {showing.reason || showing.action ? (
          <span className="tiny muted" style={{ display: "block", marginTop: 4 }}>
            {[showing.reason, showing.action].filter(Boolean).join(" ")}
          </span>
        ) : null}
      </div>

      <p className="tiny muted" style={{ margin: 0 }}>
        Opening a question, showing its results and picking a participant all switch this screen
        for you. Closing a poll leaves it where it is.
      </p>

      <div className="stack-sm">
        <div>
          <button
            className="btn btn-sm"
            onClick={() => setShowPicker((open) => !open)}
            aria-expanded={showPicker}
          >
            {showPicker ? "Hide screen options" : "Change screen content"}
          </button>
        </div>

        {showPicker ? (
          <>
            <div className="btn-group">
              {SCREEN_ORDER.map((mode) => {
                // The current screen's own note is in the status block above, so
                // only the others carry a hint paragraph to point at.
                const hasHint = mode !== publicMode && describeScreen(mode, context).reason !== null;
                return (
                  <button
                    key={mode}
                    className={`btn btn-sm ${publicMode === mode ? "btn-primary" : ""}`}
                    disabled={disabled}
                    aria-pressed={publicMode === mode}
                    aria-describedby={hasHint ? `${hintId}-${mode}` : undefined}
                    onClick={() => act(`/api/rooms/${code}/public-mode`, { mode })}
                  >
                    {SCREEN_LABELS[mode]}
                  </button>
                );
              })}
            </div>

            {/* Say which of these have nothing behind them before they are
                clicked, rather than letting the instructor pick one and wonder
                why the class is still looking at the join code. */}
            {SCREEN_ORDER.filter(
              (mode) => mode !== publicMode && describeScreen(mode, context).reason,
            ).map((mode) => (
              <p className="tiny muted" id={`${hintId}-${mode}`} key={mode} style={{ margin: 0 }}>
                <strong>{SCREEN_LABELS[mode]}:</strong> {describeScreen(mode, context).reason}
              </p>
            ))}

            <p className="tiny muted" style={{ margin: 0 }}>
              The presentation screen never shows the roster, and shows a learner&apos;s name only
              while it is on {SCREEN_LABELS.pick}.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
