"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { displayAnswer } from "@/lib/domain/activities";
import { REVIEW_LABELS, type ActivityResponseView, type ActivityView, type ReviewState } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * The marking pile for one activity.
 *
 * Fetched on its own rather than carried in the realtime snapshot: forty
 * learners pasting SQL would push a large payload to every connected client on
 * every save. It re-fetches whenever the room version moves, so it is as live as
 * everything else — and it stays on a route that requires the host token, which
 * is where named submissions belong.
 */
const FILTERS: { key: "all" | ReviewState; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "needs_follow_up", label: "Needs follow-up" },
  { key: "reviewed", label: "Reviewed" },
];

export function ResponsesPanel({
  code,
  activity,
  version,
  disabled,
  act,
  onClose,
}: {
  code: string;
  activity: ActivityView;
  version: number;
  disabled: boolean;
  act: HostAction;
  onClose: () => void;
}) {
  const [responses, setResponses] = useState<ActivityResponseView[] | null>(null);
  const [filter, setFilter] = useState<"all" | ReviewState>("all");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await api<{ responses: ActivityResponseView[] }>(
        `/api/rooms/${code}/activities/${activity.id}/responses`,
        { code, role: "instructor" },
      );
      setResponses(result.responses);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the answers.");
    }
  }, [activity.id, code]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const shown = (responses ?? []).filter(
    (response) => filter === "all" || response.reviewState === filter,
  );

  async function review(response: ActivityResponseView, body: Record<string, unknown>) {
    const ok = await act(`/api/rooms/${code}/responses/${response.id}`, body);
    if (ok) await load();
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Answers · {activity.title}
        </div>
        <button className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {activity.referenceAnswer ? (
        <div className="notice">
          <span className="tiny muted">Your answer, private to you</span>
          <pre className="answer-pre">{activity.referenceAnswer}</pre>
        </div>
      ) : null}

      <div className="btn-group">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            className={`btn btn-sm ${filter === entry.key ? "btn-primary" : ""}`}
            aria-pressed={filter === entry.key}
            onClick={() => setFilter(entry.key)}
          >
            {entry.label}
            {entry.key !== "all" ? ` (${activity.reviewCounts?.[entry.key] ?? 0})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      {responses === null ? <p className="empty">Loading answers…</p> : null}
      {responses !== null && shown.length === 0 ? (
        <p className="empty">Nothing in this filter.</p>
      ) : null}

      {shown.map((response) => (
        <div className="response-card" key={response.id}>
          <div className="row-between">
            <strong>{response.displayName}</strong>
            <span className={`chip ${response.reviewState === "needs_follow_up" ? "chip-warn" : ""}`}>
              {REVIEW_LABELS[response.reviewState]}
            </span>
          </div>

          {activity.fields.map((field) => {
            const value = response.answers[field.key];
            if (value === undefined) return null;
            return (
              <div className="stack-sm" key={field.key} style={{ gap: 2 }}>
                <span className="tiny muted">{field.label}</span>
                {field.type === "sql" || field.type === "long_text" ? (
                  <pre className="answer-pre">{value}</pre>
                ) : (
                  <span>{displayAnswer(field, value)}</span>
                )}
              </div>
            );
          })}

          <div className="btn-group">
            {(["pending", "reviewed", "needs_follow_up"] as ReviewState[]).map((state) => (
              <button
                key={state}
                className={`btn btn-sm ${response.reviewState === state ? "btn-primary" : ""}`}
                disabled={disabled}
                aria-pressed={response.reviewState === state}
                onClick={() => void review(response, { reviewState: state })}
              >
                {REVIEW_LABELS[state]}
              </button>
            ))}
          </div>

          <div className="btn-group">
            <button
              className={`btn btn-sm ${response.revealed ? "btn-primary" : ""}`}
              disabled={disabled}
              aria-pressed={response.revealed}
              onClick={() => void review(response, { reveal: !response.revealed })}
            >
              {response.revealed ? "Take off the screen" : "Show on screen"}
            </button>
            {response.revealed ? (
              <button
                className={`btn btn-sm ${response.revealAuthor ? "btn-primary" : ""}`}
                disabled={disabled}
                aria-pressed={response.revealAuthor}
                onClick={() =>
                  void review(response, { reveal: true, revealAuthor: !response.revealAuthor })
                }
              >
                {response.revealAuthor ? "Hide the name" : "Name the author"}
              </button>
            ) : null}
            <button
              className="btn btn-sm"
              disabled={disabled}
              onClick={() => void review(response, { invite: true })}
            >
              Invite to explain
            </button>
          </div>

          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              void review(response, {
                feedback: draft[response.id] ?? "",
                reviewState: response.reviewState === "pending" ? "reviewed" : undefined,
              }).then(() => setDraft((current) => ({ ...current, [response.id]: "" })));
            }}
          >
            <input
              className="input"
              placeholder={response.feedback ? "Replace your feedback" : "Private feedback…"}
              value={draft[response.id] ?? ""}
              maxLength={2000}
              aria-label={`Private feedback for ${response.displayName}`}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [response.id]: event.target.value }))
              }
            />
            <button className="btn btn-sm" type="submit" disabled={disabled}>
              Send
            </button>
          </form>

          {response.feedback ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              Sent: {response.feedback}
            </p>
          ) : null}
        </div>
      ))}

      <p className="tiny muted" style={{ margin: 0 }}>
        Feedback is private to that learner. Showing an answer on the screen keeps the author
        anonymous unless you name them.
      </p>
    </section>
  );
}
