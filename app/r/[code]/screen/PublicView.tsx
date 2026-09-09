"use client";

import { useRoomState } from "@/lib/client/useRoomState";
import { TimerChip } from "@/components/TimerChip";
import type { PollTally, PublicSnapshot } from "@/lib/types";

/**
 * The shared screen.
 *
 * Read-only by construction: this surface holds no token, calls no mutation,
 * and receives the public projection, which contains no roster, no participant
 * identifiers and no per-learner data of any kind. Results appear here only
 * once the instructor has revealed them.
 *
 * Everything is sized in viewport units because the real constraint is the
 * learner in the back row reading it through a screen share.
 */
export function PublicView({
  code,
  joinUrl,
  qr,
}: {
  code: string;
  joinUrl: string;
  qr: string | null;
}) {
  const { snapshot, connection } = useRoomState(code, "public");

  if (connection === "denied") {
    return (
      <main className="public-shell">
        <div className="public-main">
          <p className="public-waiting">Class {code} was not found.</p>
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="public-shell">
        <div className="public-main">
          <p className="public-waiting">Connecting…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="public-shell">
      <header className="public-header">
        <span className="public-title">
          {snapshot.room.title}
          {snapshot.room.currentSectionTitle ? (
            <span className="public-section"> · {snapshot.room.currentSectionTitle}</span>
          ) : null}
        </span>
        <span className="row" style={{ gap: 16 }}>
          {snapshot.timer ? <TimerChip timer={snapshot.timer} size="large" /> : null}
          <span className="public-code">{code}</span>
        </span>
      </header>

      <div className="public-main">
        <Stage snapshot={snapshot} joinUrl={joinUrl} qr={qr} code={code} />
      </div>

      <footer className="public-footer">
        <span>
          Join at <strong>{joinUrl}</strong>
        </span>
        <span>
          {snapshot.presentCount} {snapshot.presentCount === 1 ? "learner" : "learners"} in the room
        </span>
      </footer>
    </main>
  );
}

function Stage({
  snapshot,
  joinUrl,
  qr,
  code,
}: {
  snapshot: PublicSnapshot;
  joinUrl: string;
  qr: string | null;
  code: string;
}) {
  const mode = snapshot.room.publicMode;
  const poll = snapshot.activePoll;

  if (snapshot.room.status === "ended") {
    return <p className="public-waiting">That is all for today — thank you.</p>;
  }

  if (mode === "pick" && snapshot.lastPick) {
    return (
      <div className="stack">
        <p className="public-waiting" style={{ textAlign: "left" }}>
          Over to
        </p>
        <p className="public-pick">{snapshot.lastPick.displayName}</p>
      </div>
    );
  }

  if (mode === "response" && snapshot.revealedResponse) {
    const response = snapshot.revealedResponse;
    return (
      <div className="stack">
        <p className="public-waiting" style={{ textAlign: "left" }}>
          {response.authorName ? `${response.authorName}'s answer` : "One answer from the room"}
        </p>
        <p className="public-question">{response.activityTitle}</p>
        {response.fields.map((field) => {
          const value = response.answers[field.key];
          if (value === undefined) return null;
          return (
            <div key={field.key}>
              <p className="public-field-label">{field.label}</p>
              {field.type === "sql" || field.type === "long_text" ? (
                <pre className="public-pre">{value}</pre>
              ) : (
                <p className="public-option">
                  {field.type === "choice"
                    ? (field.options ?? []).find((option) => option.value === value)?.label ?? value
                    : value}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (mode === "activity" && snapshot.activity) {
    const activity = snapshot.activity;
    return (
      <div className="stack">
        <p className="public-question">{activity.title}</p>
        {activity.instructions ? (
          <p className="public-option">{activity.instructions}</p>
        ) : null}
        <div>
          {activity.fields.map((field) => (
            <p className="public-field-label" key={field.key}>
              {field.label}
              {field.type === "choice"
                ? `: ${(field.options ?? []).map((option) => option.label).join(" · ")}`
                : ""}
            </p>
          ))}
        </div>
        <p className="public-waiting" style={{ textAlign: "left" }}>
          {activity.status === "open" ? "Answer on your phone" : "Answers closed"}
        </p>
      </div>
    );
  }

  if (mode === "results" && poll) {
    return (
      <div className="stack">
        <p className="public-question">{poll.prompt}</p>
        {poll.tallies ? (
          <ResultBars tallies={poll.tallies} confidence={poll.kind === "confidence"} />
        ) : (
          <p className="public-waiting" style={{ textAlign: "left" }}>
            Results coming up…
          </p>
        )}
      </div>
    );
  }

  if (mode === "poll" && poll) {
    return (
      <div className="stack">
        <p className="public-question">{poll.prompt}</p>
        <div>
          {poll.options.map((option) => (
            <p className="public-option" key={option.value}>
              {option.label}
            </p>
          ))}
        </div>
        <p className="public-waiting" style={{ textAlign: "left" }}>
          {poll.status === "open"
            ? `${poll.responseCount} answered`
            : "Answers closed"}
        </p>
      </div>
    );
  }

  if (mode === "waiting") {
    return <p className="public-waiting">Back in a moment.</p>;
  }

  return <JoinStage code={code} joinUrl={joinUrl} qr={qr} />;
}

function JoinStage({
  code,
  joinUrl,
  qr,
}: {
  code: string;
  joinUrl: string;
  qr: string | null;
}) {
  return (
    <div className="public-join">
      {qr ? (
        <div className="public-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR code to join at ${joinUrl}`} />
        </div>
      ) : null}
      <div className="stack">
        <p className="public-waiting" style={{ textAlign: "left" }}>
          Join the class
        </p>
        <p className="public-join-code">{code}</p>
        <p className="public-join-url">{joinUrl}</p>
      </div>
    </div>
  );
}

function ResultBars({ tallies, confidence }: { tallies: PollTally[]; confidence: boolean }) {
  return (
    <div>
      {tallies.map((tally) => (
        <div className="public-bar-row" key={tally.value}>
          <span className="public-bar-label">{confidence ? tally.value : tally.label}</span>
          <span className="public-bar-track">
            <span
              className="public-bar-fill"
              style={{ width: `${tally.percent}%` }}
              aria-hidden="true"
            />
          </span>
          <span className="public-bar-value">{tally.percent}%</span>
        </div>
      ))}
    </div>
  );
}
