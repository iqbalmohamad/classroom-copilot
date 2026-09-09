"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiRequestError } from "@/lib/client/api";
import { TallyBars } from "@/components/Bars";
import { PULSE_LABELS, PULSE_VALUES, POLL_KIND_LABELS, REVIEW_LABELS } from "@/lib/types";
import { displayAnswer } from "@/lib/domain/activities";
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
          {/* A plain link, so the browser downloads it with the instructor's
              own cookie rather than us building a blob the page has to hold. */}
          <a className="btn btn-sm" href={`/api/rooms/${code}/summary?format=csv`} download>
            Download CSV
          </a>
        </div>
      </header>

      <section className="stat-grid">
        <Stat value={summary.learnersJoined} label="Learners joined" />
        <Stat value={`${summary.participationRate}%`} label="Took part" />
        <Stat value={summary.pollsAsked} label="Questions asked" />
        <Stat value={summary.totalResponses} label="Poll answers" />
        <Stat value={summary.questions.length} label="Learner questions" />
        <Stat value={summary.questionUpvotes} label="Question upvotes" />
        <Stat value={summary.activities.length} label="Activities" />
        <Stat value={summary.activitySubmissions} label="Activity answers" />
        <Stat value={summary.picks.length} label="Learners picked" />
        <Stat value={`${summary.durationMinutes} min`} label="Session length" />
      </section>

      {summary.sections.length > 0 ? (
        <section className="card">
          <div className="card-title">Sections</div>
          <ol className="list">
            {summary.sections.map((section) => (
              <li key={section.id}>
                <strong>{section.title}</strong>
                <span className="tiny muted">
                  {" · "}
                  {summary.activities.filter((a) => a.sectionId === section.id).length} activities ·{" "}
                  {summary.pulseRounds.filter((r) => r.sectionId === section.id).length} pulse rounds
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {summary.pulseRounds.length > 0 ? (
        <section className="card">
          <div className="card-title">Class pulse by section and round</div>
          {summary.pulseRounds.map((round) => (
            <div className="stack-sm" key={`${round.seq}`} style={{ marginBottom: 14 }}>
              <span className="tiny muted">
                {round.label ?? `Round ${round.seq}`}
                {round.sectionTitle ? ` · ${round.sectionTitle}` : ""} · {round.summary.responded}{" "}
                of {round.summary.total} responded
              </span>
              <div>
                {PULSE_VALUES.map((value) => (
                  <div className="bar-row" key={value}>
                    <span className="bar-label">{PULSE_LABELS[value]}</span>
                    <span className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: `${round.summary.percents[value]}%` }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="bar-value">
                      {round.summary.counts[value]} · {round.summary.percents[value]}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {summary.activities.length > 0 ? (
        <section className="card">
          <div className="card-title">Activities and answers</div>
          {summary.activities.map((activity) => (
            <div className="stack-sm" key={activity.id} style={{ marginBottom: 18 }}>
              <div>
                <strong>{activity.title}</strong>
                <span className="tiny muted">
                  {" · "}
                  {activity.sectionTitle ? `${activity.sectionTitle} · ` : ""}
                  {activity.attempt > 1 ? `attempt ${activity.attempt} · ` : ""}
                  {activity.responseCount} of {summary.learnersJoined} answered ·{" "}
                  {activity.reviewCounts.needs_follow_up} need follow-up
                </span>
              </div>
              {activity.instructions ? <p className="small muted">{activity.instructions}</p> : null}
              {activity.referenceAnswer ? (
                <div className="notice">
                  <span className="tiny muted">Your reference answer</span>
                  <pre className="answer-pre">{activity.referenceAnswer}</pre>
                </div>
              ) : null}
              {activity.responses.length === 0 ? (
                <p className="empty">No answers.</p>
              ) : (
                <ul className="list">
                  {activity.responses.map((response, index) => (
                    <li key={index}>
                      <div className="stack-sm" style={{ gap: 4 }}>
                        <span className="tiny muted">
                          {response.displayName} · {REVIEW_LABELS[response.reviewState]}
                        </span>
                        {activity.fields.map((field) => {
                          const value = response.answers[field.key];
                          if (value === undefined) return null;
                          return field.type === "sql" || field.type === "long_text" ? (
                            <pre className="answer-pre" key={field.key}>
                              {value}
                            </pre>
                          ) : (
                            <span className="small" key={field.key}>
                              {field.label}: {displayAnswer(field, value)}
                            </span>
                          );
                        })}
                        {response.feedback ? (
                          <span className="tiny muted">Your feedback: {response.feedback}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {summary.materials.length > 0 ? (
        <section className="card">
          <div className="card-title">Materials shared</div>
          <ul className="list">
            {summary.materials.map((material, index) => (
              <li key={index}>
                <span>{material.title}</span>
                <span className="tiny muted">
                  {" · "}
                  {material.sectionTitle ?? "whole session"} · {material.url}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
                  <span className={`chip ${question.unresolved ? "chip-warn" : ""}`}>
                    {question.status === "answered"
                      ? "Answered"
                      : question.status === "hidden"
                        ? "Removed"
                        : "Unresolved"}
                  </span>
                </div>
                <span className="tiny muted">
                  {question.authorName ?? "Anonymous"}
                  {question.activityTitle
                    ? ` · ${question.activityTitle}`
                    : question.sectionTitle
                      ? ` · ${question.sectionTitle}`
                      : " · general"}
                </span>
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
