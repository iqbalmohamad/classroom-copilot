"use client";

import { useEffect, useState } from "react";
import { secondsRemaining, type TimerState } from "@/lib/domain/timers";

/**
 * Seconds left on the room's timer, ticking locally between snapshots.
 *
 * The authority is the stored deadline that arrives in the snapshot; this only
 * animates the number in between, so three surfaces watching the same timer
 * agree to within their clock skew and a refresh costs nobody a second.
 */
export function useCountdown(
  timer: Pick<TimerState, "status" | "endsAt" | "remainingSeconds"> | null,
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer || timer.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [timer?.status, timer?.endsAt, timer]);

  if (!timer) return 0;
  return secondsRemaining(timer as TimerState, now);
}
