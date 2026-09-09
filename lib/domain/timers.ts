/**
 * Activity and break timers.
 *
 * The clock is a stored deadline, not a countdown running in someone's browser.
 * Every surface subtracts `endsAt` from its own now, so the instructor's laptop
 * sleeping cannot hand the class extra minutes and a learner refreshing cannot
 * lose any. A paused timer stores what was left instead.
 */

export type TimerStatus = "running" | "paused" | "ended";

export interface TimerState {
  id: string;
  label: string;
  status: TimerStatus;
  durationSeconds: number;
  /** ISO instant the clock runs out. Present while running. */
  endsAt: string | null;
  /** What was left when it was paused. Present while paused. */
  remainingSeconds: number | null;
  /** Whether closing the linked activity is part of the deadline. */
  autoClose: boolean;
  /** True when the clock reached zero, as opposed to being ended by hand. */
  expired: boolean;
  activityId: string | null;
}

export const MIN_DURATION_SECONDS = 10;
export const MAX_DURATION_SECONDS = 36_000;

export function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 300;
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(seconds)));
}

/**
 * Seconds left, from any surface's point of view.
 *
 * Never negative: a timer that ran out reads zero everywhere, and "how long
 * ago it ran out" is not something a classroom countdown should display.
 */
export function secondsRemaining(timer: TimerState, now: number = Date.now()): number {
  if (timer.status === "ended") return 0;
  if (timer.status === "paused") return Math.max(0, timer.remainingSeconds ?? 0);
  if (!timer.endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(timer.endsAt).getTime() - now) / 1000));
}

/** A running timer whose deadline has passed but which nothing has closed yet. */
export function hasExpired(timer: TimerState, now: number = Date.now()): boolean {
  if (timer.status !== "running" || !timer.endsAt) return false;
  return new Date(timer.endsAt).getTime() <= now;
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
