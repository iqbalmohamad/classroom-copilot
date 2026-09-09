import type { PollTally } from "@/lib/types";

/**
 * Aggregate result bars. Used by the instructor console and the summary; the
 * public view has its own larger variant tuned for reading across a room.
 */
export function TallyBars({ tallies, tone }: { tallies: PollTally[]; tone?: string }) {
  return (
    <div>
      {tallies.map((t) => (
        <div className="bar-row" key={t.value}>
          <span className="bar-label">{t.label}</span>
          <span className="bar-track">
            <span
              className={`bar-fill ${tone ?? ""}`}
              style={{ width: `${t.percent}%` }}
              aria-hidden="true"
            />
          </span>
          <span className="bar-value">
            {t.count} · {t.percent}%
          </span>
        </div>
      ))}
    </div>
  );
}
