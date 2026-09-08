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
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ reading: string }>(`/api/rooms/${code}/ai-read`, {
        method: "POST",
        code,
        role: "instructor",
      });
      setReading(result.reading);
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

      {reading ? <p className="small">{reading}</p> : null}
      {error ? (
        <p className="small muted" role="status">
          {error}
        </p>
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
