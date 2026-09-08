"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiRequestError } from "@/lib/client/api";
import { TallyBars } from "@/components/Bars";
import { PULSE_LABELS, PULSE_VALUES, POLL_KIND_LABELS } from "@/lib/types";
import type { SessionSummary } from "@/lib/summary";

/**
 * Session summary — instructor only.
 *
 * A plain readout of what happened, laid out to be printed or screenshotted
 * straight after class. Question text is included with author names only where
 * a learner chose not to be anonymous.
 */
export function SummaryView({ code }: { code: string }) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api<{ summary: SessionSummary }>(`/api/rooms/${code}/summary`, {
          code,
          role: "instructor",
        });
        if (!cancelled) setSummary(result.summary);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiRequestError ? err.message : "Could not load the summary.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <main className="page page-narrow stack">
        <h1 style={{ fontSize: 24 }}>Session summary</h1>
        <div className="notice notice-error" role="alert">
          {error}
        </div>
        <Link className="btn" href="/">
          Back to start
        </Link>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="page">
        <p className="muted">Loading summary…</p>
      </main>
    );
  }

  const started = new Date(summary.startedAt);

  return (
    <main className="page stack">
      <header className="row-between no-print">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1 style={{ fontSize: 24 }}>{summary.room.title}</h1>
          <p className="tiny muted">
            {started.toLocaleString()} · class code {summary.room.code}
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-sm" href={`/r/${code}/host`}>
            Back to console
          </Link>
          <button className="btn btn-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      <section className="stat-grid">
        <Stat value={summary.learnersJoined} label="Learners joined" />
        <Stat value={`${summary.participationRate}%`} label="Took part" />
        <Stat value={summary.pollsAsked} label="Questions asked" />
        <Stat value={summary.totalResponses} label="Poll answers" />
        <Stat value={summary.questions.length} label="Learner questions" />
        <Stat value={summary.questionUpvotes} label="Question upvotes" />
        <Stat value={summary.picks.length} label="Learners picked" />
        <Stat value={`${summary.durationMinutes} min`} label="Session length" />
      </section>

      <section className="card">
        <div className="card-title">Class pulse at the end</div>
        {summary.pulse.responded === 0 ? (
          <p className="empty">No pulse responses were recorded.</p>
        ) : (
          <div>
            {PULSE_VALUES.map((value) => (
              <div className="bar-row" key={value}>
                <span className="bar-label">{PULSE_LABELS[value]}</span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ width: `${summary.pulse.percents[value]}%` }}
                    aria-hidden="true"
                  />
                </span>
                <span className="bar-value">
                  {summary.pulse.counts[value]} · {summary.pulse.percents[value]}%
                </span>
              </div>
            ))}
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {summary.pulse.responded} of {summary.pulse.total} learners set a pulse ·{" "}
              {summary.pulseUpdates} updates during the session
            </p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">Polls</div>
        {summary.polls.length === 0 ? (
          <p className="empty">No polls were run.</p>
        ) : (
          <ul className="list">
            {summary.polls.map((poll) => (
              <li key={poll.seq}>
                <div className="stack-sm">
                  <div className="row-between">
                    <strong className="grow">
                      {poll.seq}. {poll.prompt}
                    </strong>
                    <span className="chip">{POLL_KIND_LABELS[poll.kind]}</span>
                    <span className="chip">
                      {poll.responseCount} answers · {poll.responseRate}%
                    </span>
                  </div>
                  {poll.responseCount > 0 ? <TallyBars tallies={poll.tallies} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-title">Questions from learners</div>
        {summary.questions.length === 0 ? (
          <p className="empty">No questions were submitted.</p>
        ) : (
          <ul className="list">
            {summary.questions.map((question, index) => (
              <li key={index}>
                <div className="row-between" style={{ alignItems: "flex-start" }}>
                  <p className="question-body grow">{question.body}</p>
                  <span className="chip">{question.votes} votes</span>
                  <span className="chip">
                    {question.status === "answered"
                      ? "Answered"
                      : question.status === "hidden"
                        ? "Removed"
                        : "Open"}
                  </span>
                </div>
                <span className="tiny muted">{question.authorName ?? "Anonymous"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-title">Participant picker</div>
        {summary.picks.length === 0 ? (
          <p className="empty">No one was picked.</p>
        ) : (
          <ul className="list">
            {summary.picks.map((pick, index) => (
              <li key={index}>
                <div className="row-between">
                  <span className="grow">{pick.displayName}</span>
                  <span className="tiny muted">
                    {new Date(pick.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
