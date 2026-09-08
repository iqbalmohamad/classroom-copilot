"use client";

import type { RosterEntry } from "@/lib/types";

/**
 * The roster — private to the instructor and never included in any learner or
 * public projection.
 *
 * It shows who is in the room and who has been called on, and nothing else.
 * Learners are told their pulse is reported only as a class aggregate, and no
 * individual poll answer is shown to anyone, so neither appears here — the
 * snapshot this reads from does not even carry them.
 */
export function RosterPanel({ roster }: { roster: RosterEntry[] }) {
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
                  {entry.pickedCount > 0 ? (
                    <span className="chip tiny">
                      Picked {entry.pickedCount > 1 ? `${entry.pickedCount}×` : ""}
                    </span>
                  ) : null}
                  {!entry.present ? <span className="chip tiny">Away</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Private to you. Never shown on the shared screen. Pulse and poll answers
        are only ever counted, never attributed.
      </p>
    </section>
  );
}
