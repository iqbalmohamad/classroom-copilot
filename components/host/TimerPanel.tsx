"use client";

import { useState } from "react";
import { TimerChip } from "@/components/TimerChip";
import type { ActivityView, TimerView } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * The clock.
 *
 * Presets first, because mid-lesson nobody types a duration. The consequences
 * of ending are spelled out rather than implied: with auto-close on, "End now"
 * closes the answers, and a finished timer cannot be extended back into life.
 */
const PRESETS = [3, 5, 8, 10];

export function TimerPanel({
  code,
  timer,
  activities,
  disabled,
  act,
}: {
  code: string;
  timer: TimerView | null;
  activities: ActivityView[];
  disabled: boolean;
  act: HostAction;
}) {
  const [activityId, setActivityId] = useState<string>("");
  const [autoClose, setAutoClose] = useState(true);

  const open = activities.filter((activity) => activity.status === "open");
  const linked = timer?.activityId
    ? activities.find((activity) => activity.id === timer.activityId)
    : null;

  async function start(minutes: number) {
    await act(`/api/rooms/${code}/timers`, {
      durationSeconds: minutes * 60,
      label: activityId ? "Activity" : "Break",
      activityId: activityId || null,
      autoClose: activityId ? autoClose : false,
    });
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Timer
        </div>
        {timer ? <TimerChip timer={timer} /> : null}
      </div>

      {timer ? (
        <>
          <p className="tiny muted" style={{ margin: 0 }}>
            {linked ? `Linked to “${linked.title}”. ` : "A break timer. "}
            {timer.autoClose
              ? "Answers close by themselves when it runs out — and when you end it."
              : "Answers stay open when it runs out."}
          </p>
          <div className="btn-group">
            {timer.status === "running" ? (
              <button
                className="btn btn-sm"
                disabled={disabled}
                onClick={() => void act(`/api/rooms/${code}/timers/${timer.id}`, { action: "pause" })}
              >
                Pause
              </button>
            ) : (
              <button
                className="btn btn-sm"
                disabled={disabled}
                onClick={() => void act(`/api/rooms/${code}/timers/${timer.id}`, { action: "resume" })}
              >
                Resume
              </button>
            )}
            <button
              className="btn btn-sm"
              disabled={disabled}
              onClick={() =>
                void act(`/api/rooms/${code}/timers/${timer.id}`, { action: "extend", seconds: 60 })
              }
            >
              +1 min
            </button>
            <button
              className="btn btn-sm"
              disabled={disabled}
              onClick={() =>
                void act(`/api/rooms/${code}/timers/${timer.id}`, { action: "extend", seconds: 300 })
              }
            >
              +5 min
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={disabled}
              onClick={() => {
                const warning = timer.autoClose
                  ? "End the timer now? This also closes answers for the linked activity."
                  : "End the timer now?";
                if (window.confirm(warning)) {
                  void act(`/api/rooms/${code}/timers/${timer.id}`, { action: "end" });
                }
              }}
            >
              End now
            </button>
          </div>
        </>
      ) : (
        <>
          {open.length > 0 ? (
            <div className="stack-sm">
              <label className="label" htmlFor="timer-activity">
                Count down for
              </label>
              <select
                id="timer-activity"
                className="select"
                value={activityId}
                onChange={(event) => setActivityId(event.target.value)}
              >
                <option value="">A break — nothing linked</option>
                {open.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.title}
                  </option>
                ))}
              </select>
              {activityId ? (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={autoClose}
                    onChange={(event) => setAutoClose(event.target.checked)}
                  />
                  Close answers when the time runs out
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="btn-group">
            {PRESETS.map((minutes) => (
              <button
                key={minutes}
                className="btn btn-sm"
                disabled={disabled}
                onClick={() => void start(minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
