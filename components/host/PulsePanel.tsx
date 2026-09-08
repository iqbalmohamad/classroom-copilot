"use client";

import { PULSE_LABELS, PULSE_VALUES, type PulseSummary } from "@/lib/types";
import type { HostAction } from "./types";

const TONE: Record<string, string> = {
  got_it: "bar-fill-ok",
  shaky: "bar-fill-warn",
  lost: "bar-fill-bad",
};

/**
 * The class pulse.
 *
 * Aggregate only — the instructor never sees which learner chose what, which is
 * the whole reason learners are willing to admit they are lost.
 */
export function PulsePanel({
  pulse,
  disabled,
  act,
  code,
}: {
  pulse: PulseSummary;
  disabled: boolean;
  act: HostAction;
  code: string;
}) {
  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Class pulse
        </div>
        <span className="tiny muted">
          {pulse.responded} of {pulse.total} responded
        </span>
      </div>

      {pulse.responded === 0 ? (
        <p className="empty">No one has set their pulse yet.</p>
      ) : (
        <div>
          {PULSE_VALUES.map((value) => (
            <div className="bar-row" key={value}>
              <span className="bar-label">{PULSE_LABELS[value]}</span>
              <span className="bar-track">
                <span
                  className={`bar-fill ${TONE[value]}`}
                  style={{ width: `${pulse.percents[value]}%` }}
                  aria-hidden="true"
                />
              </span>
              <span className="bar-value">
                {pulse.counts[value]} · {pulse.percents[value]}%
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn btn-sm"
        disabled={disabled || pulse.responded === 0}
        onClick={() => act(`/api/rooms/${code}/pulse`, undefined, "DELETE")}
      >
        Reset for next topic
      </button>
    </section>
  );
}
