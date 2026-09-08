"use client";

import { PULSE_LABELS, type RosterEntry } from "@/lib/types";

/**
 * The roster — private to the instructor and never included in any learner or
 * public projection.
 *
 * It shows *whether* a learner has answered the live poll, never what they
 * answered: participation is the instructor's business, individual answers are
 * not, and there are no right answers in this product anyway.
 */
export function RosterPanel({
  roster,
  hasActivePoll,
}: {
  roster: RosterEntry[];
  hasActivePoll: boolean;
}) {
  const present = roster.filter((entry) => entry.present);
  const away = roster.filter((entry) => !entry.present);

  return (
    <section className="card">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Who is here
        </div>
        <span className="tiny muted">
          {present.length} here{away.length > 0 ? ` · ${away.length} away` : ""}
        </span>
      </div>

      {roster.length === 0 ? (
        <p className="empty">No one has joined yet. Share the code to get started.</p>
      ) : (
        <div className="scroll-y">
          <ul className="list">
            {[...present, ...away].map((entry) => (
              <li key={entry.id}>
                <div className="row-between">
                  <span className={entry.present ? "grow" : "grow muted"}>
                    {entry.displayName}
                  </span>
                  {entry.pulse ? (
                    <span className="chip tiny">{PULSE_LABELS[entry.pulse]}</span>
                  ) : null}
                  {hasActivePoll && entry.answeredActivePoll ? (
                    <span className="chip chip-live tiny">Answered</span>
                  ) : null}
                  {!entry.present ? <span className="chip tiny">Away</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Private to you. Never shown on the shared screen.
      </p>
    </section>
  );
}
