"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { learnerToken, rememberedName } from "@/lib/client/tokens";
import { useRoomState } from "@/lib/client/useRoomState";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import {
  PULSE_LABELS,
  PULSE_VALUES,
  type LearnerSnapshot,
  type PulseValue,
} from "@/lib/types";

/**
 * The learner surface.
 *
 * Mental model, in order down the page: am I being asked something, how am I
 * doing, what do I want to ask. Nothing is nested, nothing needs explaining,
 * and every control is a full-width target sized for a thumb.
 */
export function LearnerView({ code }: { code: string }) {
  const [joined, setJoined] = useState<boolean | null>(null);

  // A learner who already has a session for this room (a refresh, a phone
  // waking up) must land straight back in the class, not on a name form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api(`/api/rooms/${code}/state?role=learner`, { code, role: "learner" });
        if (!cancelled) setJoined(true);
      } catch {
        if (!cancelled) setJoined(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (joined === null) {
    return (
      <main className="learner-shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return joined ? (
    <LearnerRoom code={code} onLeave={() => setJoined(false)} />
  ) : (
    <JoinForm code={code} onJoined={() => setJoined(true)} />
  );
}

// ------------------------------------------------------------------- join

function JoinForm({ code, onJoined }: { code: string; onJoined: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remembered = rememberedName.get();
    if (remembered) setName(remembered);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ displayName: string; learnerToken: string }>(
        `/api/rooms/${code}/join`,
        { method: "POST", body: { displayName: name }, code, role: "learner" },
      );
      learnerToken.set(code, result.learnerToken);
      rememberedName.set(result.displayName);
      onJoined();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not join.");
      setBusy(false);
    }
  }

  return (
    <main className="learner-shell stack">
      <header className="stack-sm">
        <p className="muted small">Joining class</p>
        <h1 className="code-display">{code}</h1>
      </header>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <form className="card stack" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="display-name">
            Your name
          </label>
          <input
            id="display-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            required
            autoFocus
            autoComplete="given-name"
            enterKeyHint="go"
            placeholder="First name is fine"
          />
        </div>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
          {busy ? "Joining…" : "Join class"}
        </button>
        <p className="tiny muted">
          No account, no password. Your name is visible to your instructor only.
        </p>
      </form>
    </main>
  );
}

// ------------------------------------------------------------------- room

function LearnerRoom({ code, onLeave }: { code: string; onLeave: () => void }) {
  const { snapshot, connection, refresh } = useRoomState(code, "learner");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (connection === "denied") onLeave();
  }, [connection, onLeave]);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 4000);
  }, []);

  if (!snapshot) {
    return (
      <main className="learner-shell">
        <p className="muted">Connecting to the class…</p>
      </main>
    );
  }

  const ended = snapshot.room.status === "ended";

  return (
    <main className="learner-shell stack">
      <header className="row-between">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="tiny muted">{snapshot.room.title}</span>
          <strong>{snapshot.me.displayName}</strong>
        </div>
        <ConnectionBadge connection={connection} />
      </header>

      {ended ? (
        <div className="notice" role="status">
          This class has ended. Thanks for taking part.
        </div>
      ) : null}

      {notice ? (
        <div className="notice notice-error" role="alert">
          {notice}
        </div>
      ) : null}

      {snapshot.spotlight ? (
        <div className="spotlight-banner" role="status">
          You have been picked — over to you
        </div>
      ) : null}

      <PollCard
        code={code}
        snapshot={snapshot}
        disabled={ended}
        onError={flash}
        onDone={refresh}
      />

      <PulseCard
        code={code}
        current={snapshot.me.pulse}
        disabled={ended}
        onError={flash}
        onDone={refresh}
      />

      <QuestionsCard
        code={code}
        questions={snapshot.questions}
        disabled={ended}
        onError={flash}
        onDone={refresh}
      />
    </main>
  );
}

// ------------------------------------------------------------------- poll

function PollCard({
  code,
  snapshot,
  disabled,
  onError,
  onDone,
}: {
  code: string;
  snapshot: LearnerSnapshot;
  disabled: boolean;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const poll = snapshot.activePoll;
  const [pending, setPending] = useState<string | null>(null);

  if (!poll) {
    return (
      <section className="card">
        <div className="card-title">Question</div>
        <p className="empty">No question right now. Keep an eye on the screen.</p>
      </section>
    );
  }

  const open = poll.status === "open" && !disabled;
  const selected = snapshot.myAnswer;

  async function answer(value: string) {
    if (!open || pending) return;
    setPending(value);
    try {
      await api(`/api/rooms/${code}/polls/${poll!.id}/respond`, {
        method: "POST",
        body: { value },
        code,
        role: "learner",
      });
      onDone();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "Could not send your answer.");
      onDone();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Question
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

      <h2 style={{ fontSize: 21 }}>{poll.prompt}</h2>

      <div className={`answer-grid ${poll.kind === "confidence" ? "confidence-grid" : ""}`}>
        {poll.options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className="answer-btn"
              data-selected={isSelected}
              disabled={!open || pending !== null}
              onClick={() => answer(option.value)}
              aria-pressed={isSelected}
            >
              <span>{poll.kind === "confidence" ? option.value : option.label}</span>
              {isSelected ? (
                <span className="answer-tick" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selected ? (
        <p className="small muted">
          {open ? "Answer sent. You can change it until the poll closes." : "Your answer was sent."}
        </p>
      ) : open ? (
        <p className="small muted">Choose an answer.</p>
      ) : (
        <p className="small muted">This poll is closed.</p>
      )}

      {poll.tallies ? (
        <>
          <hr className="divider" />
          <div className="card-title" style={{ marginBottom: 4 }}>
            Class results
          </div>
          {poll.tallies.map((tally) => (
            <div className="bar-row" key={tally.value}>
              <span className="bar-label">
                {poll.kind === "confidence" ? tally.value : tally.label}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${tally.percent}%` }}
                  aria-hidden="true"
                />
              </span>
              <span className="bar-value">{tally.percent}%</span>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ pulse

function PulseCard({
  code,
  current,
  disabled,
  onError,
  onDone,
}: {
  code: string;
  current: PulseValue | null;
  disabled: boolean;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function send(pulse: PulseValue) {
    if (disabled || busy) return;
    setBusy(true);
    try {
      await api(`/api/rooms/${code}/pulse`, {
        method: "POST",
        body: { pulse },
        code,
        role: "learner",
      });
      onDone();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        How are you doing?
      </div>
      <div className="pulse-grid">
        {PULSE_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            className="pulse-btn"
            data-value={value}
            data-active={current === value}
            aria-pressed={current === value}
            disabled={disabled || busy}
            onClick={() => send(value)}
          >
            {PULSE_LABELS[value]}
          </button>
        ))}
      </div>
      <p className="tiny muted">
        Only the overall class mix is shown to your instructor — never who chose what.
      </p>
    </section>
  );
}

// -------------------------------------------------------------- questions

function QuestionsCard({
  code,
  questions,
  disabled,
  onError,
  onDone,
}: {
  code: string;
  questions: LearnerSnapshot["questions"];
  disabled: boolean;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || body.trim().length < 2) return;
    setBusy(true);
    try {
      await api(`/api/rooms/${code}/questions`, {
        method: "POST",
        body: { body, anonymous },
        code,
        role: "learner",
      });
      setBody("");
      setSent(true);
      window.setTimeout(() => setSent(false), 3000);
      onDone();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "Could not send your question.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(questionId: string) {
    try {
      await api(`/api/rooms/${code}/questions/${questionId}/vote`, {
        method: "POST",
        code,
        role: "learner",
      });
      onDone();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : "Could not register your vote.");
    }
  }

  const openQuestions = questions.filter((q) => q.status === "open");
  const answered = questions.filter((q) => q.status === "answered");

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Ask a question
      </div>

      <form className="stack" onSubmit={submit}>
        <textarea
          className="textarea"
          value={body}
          maxLength={500}
          disabled={disabled}
          placeholder="What would you like the instructor to explain?"
          onChange={(event) => setBody(event.target.value)}
          aria-label="Your question"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={anonymous}
            disabled={disabled}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          Send anonymously
        </label>
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={disabled || busy || body.trim().length < 2}
        >
          {busy ? "Sending…" : "Send question"}
        </button>
        {sent ? (
          <div className="notice notice-ok" role="status">
            Sent to your instructor.
          </div>
        ) : null}
      </form>

      <hr className="divider" />

      <div className="card-title" style={{ marginBottom: 0 }}>
        Class questions
      </div>
      {openQuestions.length === 0 && answered.length === 0 ? (
        <p className="empty">No questions yet. Yours can be the first.</p>
      ) : (
        <ul className="list">
          {openQuestions.map((question) => (
            <li key={question.id}>
              <div className="question-item">
                <button
                  type="button"
                  className="vote-btn"
                  data-voted={question.votedByMe === true}
                  disabled={disabled}
                  onClick={() => vote(question.id)}
                  aria-label={
                    question.votedByMe
                      ? `Remove your upvote. ${question.votes} votes`
                      : `Upvote this question. ${question.votes} votes`
                  }
                >
                  <span className="vote-count">{question.votes}</span>
                  <span className="vote-caption">{question.votedByMe ? "Voted" : "Vote"}</span>
                </button>
                <p className="question-body grow">{question.body}</p>
              </div>
            </li>
          ))}
          {answered.map((question) => (
            <li key={question.id} className="answered">
              <div className="question-item">
                <span className="chip chip-live">Answered</span>
                <p className="question-body grow">{question.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
