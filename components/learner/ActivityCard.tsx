"use client";

import { useEffect, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { REVIEW_LABELS, type ActivityView, type MySubmission } from "@/lib/types";

/**
 * One open activity, on a phone.
 *
 * The form is whatever the instructor asked for: a word, a number, a paragraph,
 * pasted SQL, a choice with an explanation. A submission can be edited while the
 * activity is open — the server replaces rather than appends, so there is never
 * a second answer from the same learner.
 *
 * Learners are told plainly, before they type, that their name is attached for
 * the instructor. That is the honest version of "the instructor can invite you
 * to explain your answer", and it is the only place identity is promised.
 */
export function ActivityCard({
  code,
  activity,
  submission,
  disabled,
  onError,
  onDone,
}: {
  code: string;
  activity: ActivityView;
  submission: MySubmission | undefined;
  disabled: boolean;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(submission?.answers ?? {});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(!submission);

  // A submission arriving from another device (or a first save) becomes the new
  // starting point, but never overwrites something being typed right now.
  useEffect(() => {
    if (!editing && submission) setAnswers(submission.answers);
  }, [editing, submission]);

  const open = activity.status === "open" && !disabled;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !open) return;
    setBusy(true);
    try {
      await api(`/api/rooms/${code}/activities/${activity.id}/respond`, {
        method: "POST",
        body: { answers },
        code,
        role: "learner",
      });
      setSaved(true);
      setEditing(false);
      window.setTimeout(() => setSaved(false), 3000);
      onDone();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "Could not send your answer.");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const showForm = open && (editing || !submission);

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Activity
        </div>
        {open ? (
          <span className="chip chip-live">
            <span className="dot" aria-hidden="true" />
            Open
          </span>
        ) : (
          <span className="chip">Closed</span>
        )}
      </div>

      <h2 style={{ fontSize: 20 }}>{activity.title}</h2>
      {activity.instructions ? <p className="small muted">{activity.instructions}</p> : null}

      {showForm ? (
        <form className="stack-sm" onSubmit={submit}>
          {activity.fields.map((field) => {
            const id = `${activity.id}-${field.key}`;
            const value = answers[field.key] ?? "";
            const set = (next: string) =>
              setAnswers((current) => ({ ...current, [field.key]: next }));

            return (
              <div className="field" key={field.key}>
                <label className="label" htmlFor={id}>
                  {field.label}
                  {field.required ? "" : " (optional)"}
                </label>

                {field.type === "choice" ? (
                  <div className="answer-grid">
                    {(field.options ?? []).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="answer-btn"
                        data-selected={value === option.value}
                        aria-pressed={value === option.value}
                        onClick={() => set(option.value)}
                      >
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : field.type === "long_text" || field.type === "sql" ? (
                  <textarea
                    id={id}
                    className={`textarea ${field.type === "sql" ? "textarea-code" : ""}`}
                    value={value}
                    placeholder={field.placeholder}
                    spellCheck={field.type !== "sql"}
                    autoCapitalize={field.type === "sql" ? "none" : undefined}
                    autoCorrect={field.type === "sql" ? "off" : undefined}
                    onChange={(event) => set(event.target.value)}
                  />
                ) : (
                  <input
                    id={id}
                    className="input"
                    value={value}
                    placeholder={field.placeholder}
                    inputMode={field.type === "number" ? "decimal" : undefined}
                    onChange={(event) => set(event.target.value)}
                  />
                )}
              </div>
            );
          })}

          <p className="tiny muted" style={{ margin: 0 }}>
            Your name is attached to this for the instructor, so they can give you feedback or ask
            you to talk it through. Other learners never see it.
          </p>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Sending…" : submission ? "Update my answer" : "Send my answer"}
          </button>
        </form>
      ) : (
        <div className="stack-sm">
          {submission ? (
            <>
              <span className="tiny muted">
                {saved ? "Saved." : "Sent"} · {REVIEW_LABELS[submission.reviewState]}
              </span>
              {activity.fields.map((field) => {
                const value = submission.answers[field.key];
                if (value === undefined) return null;
                return (
                  <div className="stack-sm" key={field.key} style={{ gap: 2 }}>
                    <span className="tiny muted">{field.label}</span>
                    {field.type === "sql" || field.type === "long_text" ? (
                      <pre className="answer-pre">{value}</pre>
                    ) : (
                      <span>
                        {field.type === "choice"
                          ? (field.options ?? []).find((o) => o.value === value)?.label ?? value
                          : value}
                      </span>
                    )}
                  </div>
                );
              })}
              {open ? (
                <button className="btn btn-block" onClick={() => setEditing(true)}>
                  Change my answer
                </button>
              ) : null}
            </>
          ) : (
            <p className="empty">This activity is closed.</p>
          )}
        </div>
      )}

      {submission?.feedback ? (
        <div className="notice notice-ok">
          <span className="tiny muted">Feedback from your instructor, only you can see this</span>
          <p className="small" style={{ margin: "4px 0 0" }}>
            {submission.feedback}
          </p>
        </div>
      ) : null}
    </section>
  );
}
