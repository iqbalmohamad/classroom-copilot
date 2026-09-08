"use client";

import { useMemo, useState } from "react";
import type { QuestionView } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * The anonymous question queue.
 *
 * Sorted by upvotes so the question the class actually wants answered is at the
 * top. "Answered" moves a question out of the way; "Hide" exists because a live
 * class occasionally needs an anonymous message removed from every learner's
 * screen immediately, and there is no other way to do that.
 */
export function QuestionQueue({
  questions,
  disabled,
  act,
  code,
}: {
  questions: QuestionView[];
  disabled: boolean;
  act: HostAction;
  code: string;
}) {
  const [showHidden, setShowHidden] = useState(false);

  const { open, answered, hidden } = useMemo(() => {
    const byVotes = (a: QuestionView, b: QuestionView) =>
      b.votes - a.votes || b.createdAt.localeCompare(a.createdAt);
    return {
      open: questions.filter((q) => q.status === "open").sort(byVotes),
      answered: questions.filter((q) => q.status === "answered").sort(byVotes),
      hidden: questions.filter((q) => q.status === "hidden"),
    };
  }, [questions]);

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Questions from the class
        </div>
        <span className="tiny muted">{open.length} waiting</span>
      </div>

      {open.length === 0 ? (
        <p className="empty">No open questions right now.</p>
      ) : (
        <ul className="list">
          {open.map((question) => (
            <li key={question.id}>
              <div className="row-between" style={{ alignItems: "flex-start" }}>
                <div className="grow stack-sm" style={{ gap: 4 }}>
                  <p className="question-body">{question.body}</p>
                  <span className="tiny muted">
                    {question.votes} {question.votes === 1 ? "vote" : "votes"}
                    {question.authorName ? ` · ${question.authorName}` : " · anonymous"}
                  </span>
                </div>
                <div className="btn-group">
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={disabled}
                    onClick={() =>
                      act(`/api/rooms/${code}/questions/${question.id}`, { action: "answer" })
                    }
                  >
                    Answered
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={disabled}
                    onClick={() => {
                      // Sits next to "Answered" and takes the question off every
                      // learner's screen, so a mis-tap is silent and public.
                      if (window.confirm("Remove this question from everyone's screen?")) {
                        void act(`/api/rooms/${code}/questions/${question.id}`, { action: "hide" });
                      }
                    }}
                    title="Remove this question from every learner's screen"
                  >
                    Hide
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {answered.length > 0 ? (
        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            Answered ({answered.length})
          </summary>
          <ul className="list">
            {answered.map((question) => (
              <li key={question.id}>
                <div className="row-between">
                  <span className="grow muted">{question.body}</span>
                  <button
                    className="btn btn-sm"
                    disabled={disabled}
                    onClick={() =>
                      act(`/api/rooms/${code}/questions/${question.id}`, { action: "reopen" })
                    }
                  >
                    Reopen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {hidden.length > 0 ? (
        <div className="stack-sm">
          <button className="btn btn-sm" onClick={() => setShowHidden((value) => !value)}>
            {showHidden ? "Hide removed" : `Removed (${hidden.length})`}
          </button>
          {showHidden ? (
            <ul className="list">
              {hidden.map((question) => (
                <li key={question.id}>
                  <div className="row-between">
                    <span className="grow muted tiny">{question.body}</span>
                    <button
                      className="btn btn-sm"
                      disabled={disabled}
                      onClick={() =>
                        act(`/api/rooms/${code}/questions/${question.id}`, { action: "reopen" })
                      }
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
