"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiRequestError } from "@/lib/client/api";
import { normalizeRoomCode } from "@/lib/room-code";

/**
 * The one page both roles land on: start a class, or join one.
 *
 * The instructor path is a single button — creating a room must never be the
 * slow part of starting a lesson — and the learner path is a single field.
 */
export function HomeScreen() {
  const router = useRouter();
  const params = useSearchParams();

  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("error") === "bad-host-link") {
      setError("That instructor link is not valid for a class we can find. Start a new one.");
    }
  }, [params]);

  async function createClass() {
    setCreating(true);
    setError(null);
    try {
      const result = await api<{ code: string }>("/api/rooms", {
        method: "POST",
        body: { title: title.trim() || undefined },
      });
      // The instructor credential stays in its httpOnly cookie. Recovery, if
      // this browser ever loses it, is the instructor link inside the console.
      router.push(`/r/${result.code}/host`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not start the class.");
      setCreating(false);
    }
  }

  function joinClass(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (normalized.length < 4) {
      setError("Enter the class code your instructor shared.");
      return;
    }
    router.push(`/r/${normalized}`);
  }

  return (
    <main className="page page-narrow">
      <header className="stack-sm" style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 30 }}>Classroom Copilot</h1>
        <p className="muted">
          See whether your class is following, while you are still teaching.
        </p>
      </header>

      {error ? (
        <div className="notice notice-error" style={{ marginBottom: 16 }} role="alert">
          {error}
        </div>
      ) : null}

      <div className="stack">
        <section className="card stack">
          <h2 style={{ fontSize: 19 }}>Start a class</h2>
          <div className="field">
            <label className="label" htmlFor="class-title">
              Class name <span className="faint">(optional)</span>
            </label>
            <input
              id="class-title"
              className="input"
              value={title}
              maxLength={80}
              placeholder="e.g. Week 3 — Promises"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <button
            className="btn btn-primary btn-lg btn-block"
            onClick={createClass}
            disabled={creating}
          >
            {creating ? "Starting…" : "Start class"}
          </button>
          <p className="tiny muted">
            You get a join code and link straight away. No account needed.
          </p>
        </section>

        <section className="card stack">
          <h2 style={{ fontSize: 19 }}>Join a class</h2>
          <form className="stack" onSubmit={joinClass}>
            <div className="field">
              <label className="label" htmlFor="class-code">
                Class code
              </label>
              <input
                id="class-code"
                className="input input-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={10}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
              />
            </div>
            <button className="btn btn-lg btn-block" type="submit">
              Join class
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
