"use client";

import { useState } from "react";
import { TallyBars } from "@/components/Bars";
import { POLL_KIND_LABELS, type InstructorSnapshot, type PollKind } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Ask the class something, then run the poll.
 *
 * The composer stays visible the whole time: launching the next question is the
 * single most common action in a lesson and must never be more than a type and
 * a click away. Its four controls are spelled out — no icon-only buttons to
 * decode while talking.
 *
 * Once a poll has actually been run, though, operating it beats preparing the
 * next one: a question that is open, or closed with a result still to show,
 * goes *above* the composer so the instructor never scrolls past a form to
 * close the poll the class is answering right now. A draft is preparation like
 * the composer itself, so it stays underneath.
 */
const KINDS: PollKind[] = ["yes_no", "multiple_choice", "confidence"];

export function PollPanel({
  snapshot,
  disabled,
  act,
  code,
}: {
  snapshot: InstructorSnapshot;
  disabled: boolean;
  act: HostAction;
  code: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<PollKind>("yes_no");
  const [labels, setLabels] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);

  const live = snapshot.activePoll ?? snapshot.polls[0] ?? null;
  const isOpen = live?.status === "open";
  const others = snapshot.polls.filter((poll) => poll.id !== live?.id);

  async function launch(openNow: boolean) {
    if (busy || prompt.trim().length === 0) return;
    setBusy(true);
    const ok = await act(`/api/rooms/${code}/polls`, {
      prompt,
      kind,
      choiceLabels: kind === "multiple_choice" ? labels : undefined,
      openNow,
    });
    if (ok) {
      setPrompt("");
      setLabels(["", "", "", ""]);
    }
    setBusy(false);
  }

  /**
   * A poll the instructor is *operating* — one that is open, or closed with
   * a result still to show, hide or reopen — outranks the composer. A draft
   * has not been asked yet, so it is preparation like the composer itself and
   * stays below it.
   */
  const operating = live !== null && live.status !== "draft";

  const composer = (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Ask the class
      </div>

      <div className="field">
        <label className="visually-hidden" htmlFor="poll-prompt">
          Question
        </label>
        <input
          id="poll-prompt"
          className="input"
          value={prompt}
          maxLength={300}
          disabled={disabled}
          placeholder="Does this make sense so far?"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>

      <div className="btn-group" role="group" aria-label="Question type">
        {KINDS.map((value) => (
          <button
            key={value}
            className={`btn btn-sm ${kind === value ? "btn-primary" : ""}`}
            aria-pressed={kind === value}
            disabled={disabled}
            onClick={() => setKind(value)}
          >
            {POLL_KIND_LABELS[value]}
          </button>
        ))}
      </div>

      {kind === "multiple_choice" ? (
        <div className="stack-sm">
          {["A", "B", "C", "D"].map((letter, index) => (
            <input
              key={letter}
              className="input"
              value={labels[index] ?? ""}
              maxLength={120}
              disabled={disabled}
              placeholder={`${letter} — optional label`}
              aria-label={`Option ${letter}`}
              onChange={(event) => {
                const next = [...labels];
                next[index] = event.target.value;
                setLabels(next);
              }}
            />
          ))}
          <p className="tiny muted">
            Leave these blank to just show A, B, C and D — useful when the options are already
            on your slide.
          </p>
        </div>
      ) : null}

      <div className="btn-group">
        <button
          className="btn btn-primary"
          disabled={disabled || busy || prompt.trim().length === 0}
          onClick={() => launch(true)}
        >
          {busy ? "Opening…" : "Open poll"}
        </button>
        <button
          className="btn"
          disabled={disabled || busy || prompt.trim().length === 0}
          onClick={() => launch(false)}
        >
          Save for later
        </button>
      </div>
    </section>
  );

  const currentPoll = live ? (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          {isOpen ? "Live poll" : "Last poll"}
        </div>
        <div className="row">
          {isOpen ? (
            <span className="chip chip-live">
              <span className="dot" aria-hidden="true" />
              Open
            </span>
          ) : (
            <span className="chip">{live.status === "draft" ? "Not open" : "Closed"}</span>
          )}
          {live.revealed ? <span className="chip chip-accent">Shown on screen</span> : null}
        </div>
      </div>

      <h2 style={{ fontSize: 19 }}>{live.prompt}</h2>

      <p className="small muted">
        {live.responseCount} {live.responseCount === 1 ? "answer" : "answers"} ·{" "}
        {snapshot.presentCount} here now
      </p>

      {live.tallies ? <TallyBars tallies={live.tallies} /> : null}

      <div className="btn-group">
        {isOpen ? (
          <button
            className="btn"
            disabled={disabled}
            onClick={() => act(`/api/rooms/${code}/polls/${live.id}`, { action: "close" })}
          >
            Close poll
          </button>
        ) : (
          <button
            className="btn"
            disabled={disabled}
            onClick={() => act(`/api/rooms/${code}/polls/${live.id}`, { action: "open" })}
          >
            {live.status === "draft" ? "Open poll" : "Reopen poll"}
          </button>
        )}
        <button
          className={`btn ${live.revealed ? "" : "btn-primary"}`}
          disabled={disabled || live.status === "draft"}
          onClick={() =>
            act(`/api/rooms/${code}/polls/${live.id}`, {
              action: live.revealed ? "hide" : "reveal",
            })
          }
        >
          {live.revealed ? "Hide results" : "Show results on screen"}
        </button>
      </div>
      <p className="tiny muted">
        You always see the live distribution. Learners and the shared screen only see it once
        you show it.
      </p>
    </section>
  ) : null;

  return (
    // The three slots are positional, so the composer is always the middle
    // child and React never remounts it — a half-typed question survives the
    // poll opening or closing underneath it. Only which slot around it holds
    // the current poll changes.
    <>
      {operating ? currentPoll : null}
      {composer}
      {operating ? null : currentPoll}

      {others.length > 0 ? (
        <section className="card">
          <div className="card-title">Your other questions</div>
          <ul className="list">
            {others.map((poll) => (
              <li key={poll.id}>
                <div className="row-between">
                  <span className="grow">{poll.prompt}</span>
                  {poll.status === "draft" ? (
                    <span className="chip">Draft</span>
                  ) : (
                    <span className="chip">{poll.responseCount} answers</span>
                  )}
                  <button
                    className="btn btn-sm"
                    disabled={disabled}
                    onClick={() =>
                      poll.status === "draft"
                        ? act(`/api/rooms/${code}/polls/${poll.id}`, { action: "open" })
                        : // A fresh round, not a reopen: reopening would bring the
                          // previous answers and results back with it.
                          act(`/api/rooms/${code}/polls/${poll.id}/again`)
                    }
                  >
                    {poll.status === "draft" ? "Open" : "Ask again"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
