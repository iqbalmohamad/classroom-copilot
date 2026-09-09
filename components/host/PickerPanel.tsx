"use client";

import { useState } from "react";
import type { PickView } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Random participant picker.
 *
 * Learners who have not been picked yet come first, and the same learner is
 * never picked twice in a row while anyone else is available. The history below
 * is what makes that visible — and lets the instructor see, honestly, who they
 * have and have not brought into the lesson.
 */
export function PickerPanel({
  picks,
  disabled,
  act,
  code,
}: {
  picks: PickView[];
  disabled: boolean;
  act: HostAction;
  code: string;
}) {
  const [busy, setBusy] = useState(false);
  const current = picks[0] ?? null;

  async function pick() {
    setBusy(true);
    await act(`/api/rooms/${code}/pick`);
    setBusy(false);
  }

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Participant picker
      </div>

      {current ? (
        <div className="stack-sm">
          <span className="tiny muted">Currently picked</span>
          <strong style={{ fontSize: 26 }}>{current.displayName}</strong>
        </div>
      ) : (
        <p className="empty">No one picked yet.</p>
      )}

      <button className="btn btn-primary" disabled={disabled || busy} onClick={pick}>
        {busy ? "Picking…" : current ? "Pick someone else" : "Pick a learner"}
      </button>

      {picks.length > 1 ? (
        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Picked this session ({picks.length})
          </summary>
          <ul className="list tiny">
            {picks.map((pick) => (
              <li key={pick.id}>{pick.displayName}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
