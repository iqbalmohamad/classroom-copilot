"use client";

import { formatCountdown } from "@/lib/domain/timers";
import { useCountdown } from "@/lib/client/useCountdown";

/**
 * The countdown, wherever it is shown.
 *
 * One component for the console, the phone and the projector so the three
 * cannot drift into showing different numbers or different words for the same
 * state.
 */
export function TimerChip({
  timer,
  size = "normal",
}: {
  timer: {
    label: string;
    status: "running" | "paused" | "ended";
    endsAt: string | null;
    remainingSeconds: number | null;
  } | null;
  size?: "normal" | "large";
}) {
  const left = useCountdown(timer);
  if (!timer || timer.status === "ended") return null;

  const paused = timer.status === "paused";
  const nearlyUp = !paused && left <= 30;
  const done = left === 0 && !paused;

  return (
    <span
      className={`timer-chip ${size === "large" ? "timer-chip-lg" : ""} ${
        nearlyUp ? "timer-chip-urgent" : ""
      }`}
      role="timer"
      aria-live="off"
    >
      <span className="timer-chip-label">{timer.label}</span>
      <span className="timer-chip-value">{done ? "time's up" : formatCountdown(left)}</span>
      {paused ? <span className="timer-chip-label">paused</span> : null}
    </span>
  );
}
