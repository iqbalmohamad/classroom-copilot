"use client";

import { useState } from "react";
import { PULSE_LABELS, PULSE_VALUES, type PulseRoundView } from "@/lib/types";
import type { HostAction } from "./types";

const TONE: Record<string, string> = {
  got_it: "bar-fill-ok",
  shaky: "bar-fill-warn",
  lost: "bar-fill-bad",
};

/**
 * The class pulse, by round.
 *
 * Aggregate only — the instructor never sees which learner chose what, which is
 * the whole reason learners are willing to admit they are lost.
 *
 * "Ask again" used to erase what the room had just said, which destroyed the
 * before half of exactly the comparison it was for. It now closes the round and
 * opens a new one, so the previous answer stays on screen underneath and the
 * two can be read side by side.
 */
export function PulsePanel({
  round,
  history,
  disabled,
  act,
  code,
}: {
  round: PulseRoundView | null;
  history: PulseRoundView[];
  disabled: boolean;
  act: HostAction;
  code: string;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const summary = round?.summary;

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Class pulse
        </div>
        <span className="tiny muted">
          {summary ? `${summary.responded} of ${summary.total} responded` : "not asked yet"}
        </span>
      </div>

      {round ? (
        <span className="tiny muted">
          {round.label ?? `Round ${round.seq}`}
          {round.sectionTitle ? ` · ${round.sectionTitle}` : ""}
        </span>
      ) : null}

      {!summary || summary.responded === 0 ? (
        <p className="empty">No one has set their pulse yet.</p>
      ) : (
        <div>
          {PULSE_VALUES.map((value) => (
            <div className="bar-row" key={value}>
              <span className="bar-label">{PULSE_LABELS[value]}</span>
              <span className="bar-track">
                <span
                  className={`bar-fill ${TONE[value]}`}
                  style={{ width: `${summary.percents[value]}%` }}
                  aria-hidden="true"
                />
              </span>
              <span className="bar-value">
                {summary.counts[value]} · {summary.percents[value]}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="btn-group">
        <button
          className="btn btn-sm"
          disabled={disabled}
          onClick={() => void act(`/api/rooms/${code}/pulse/rounds`, {})}
        >
          {round ? "Ask again" : "Ask the class"}
        </button>
        {history.length > 0 ? (
          <button
            className="btn btn-sm"
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
          >
            {showHistory ? "Hide earlier rounds" : `Earlier rounds (${history.length})`}
          </button>
        ) : null}
      </div>

      <p className="tiny muted" style={{ margin: 0 }}>
        Asking again starts a fresh round. Nothing is erased — the round below stays exactly as the
        class left it.
      </p>

      {showHistory ? (
        <ul className="list">
          {history.map((entry) => (
            <li key={entry.id}>
              <div className="stack-sm" style={{ gap: 4 }}>
                <span className="tiny muted">
                  {entry.label ?? `Round ${entry.seq}`}
                  {entry.sectionTitle ? ` · ${entry.sectionTitle}` : ""} ·{" "}
                  {entry.summary.responded} of {entry.summary.total}
                </span>
                <div>
                  {PULSE_VALUES.map((value) => (
                    <div className="bar-row" key={value}>
                      <span className="bar-label">{PULSE_LABELS[value]}</span>
                      <span className="bar-track">
                        <span
                          className={`bar-fill ${TONE[value]}`}
                          style={{ width: `${entry.summary.percents[value]}%` }}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="bar-value">
                        {entry.summary.counts[value]} · {entry.summary.percents[value]}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
