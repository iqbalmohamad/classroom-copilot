"use client";

import { useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";

/**
 * AI Class Read — optional, advisory, and completely severable.
 *
 * It reads aggregates only, it writes nothing, and if the provider is slow or
 * down the classroom is entirely unaffected. This panel only renders at all
 * when a provider key is configured on the server.
 */
export function ClassReadPanel({ code, disabled }: { code: string; disabled: boolean }) {
  const [reading, setReading] = useState<{ text: string; at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    // Clear the previous reading up front. Leaving it on screen through a
    // failure would have the instructor acting on a read of the room from
    // twenty minutes ago, believing it is current.
    setReading(null);
    try {
      const result = await api<{ reading: string }>(`/api/rooms/${code}/ai-read`, {
        method: "POST",
        code,
        role: "instructor",
      });
      setReading({
        text: result.reading,
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "The class read is unavailable right now.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Class read <span className="chip tiny">Suggestion</span>
      </div>

      {reading ? (
        <div className="stack-sm" style={{ gap: 4 }}>
          <p className="small">{reading.text}</p>
          <span className="tiny faint">Read at {reading.at}</span>
        </div>
      ) : null}
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <button className="btn btn-sm" disabled={disabled || busy} onClick={run}>
        {busy ? "Reading the room…" : reading ? "Read again" : "Read the room"}
      </button>
      <p className="tiny muted">
        A suggestion based on the current poll, pulse and questions. It never changes anything in
        your class — you decide what happens next.
      </p>
    </section>
  );
}
