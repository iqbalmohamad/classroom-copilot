"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { api, ApiRequestError } from "@/lib/client/api";
import { useRoomState } from "@/lib/client/useRoomState";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { InvitePanel } from "@/components/host/InvitePanel";
import { PresentationPanel } from "@/components/host/PresentationPanel";
import { PollPanel } from "@/components/host/PollPanel";
import { PulsePanel } from "@/components/host/PulsePanel";
import { QuestionQueue } from "@/components/host/QuestionQueue";
import { PickerPanel } from "@/components/host/PickerPanel";
import { RosterPanel } from "@/components/host/RosterPanel";
import { ClassReadPanel } from "@/components/host/ClassReadPanel";

/**
 * The instructor console.
 *
 * Everything an instructor needs mid-lesson is on one screen: no tabs, no
 * modals, no navigation. The left column is what they act on (ask a question,
 * work the queue); the right column is the class itself — the screen they are
 * sharing, how learners get in, who is here and how the room feels.
 */
export function HostConsole({
  code,
  joinUrl,
  qr,
  hostToken,
}: {
  code: string;
  joinUrl: string;
  qr: string | null;
  hostToken: string | null;
}) {
  const { snapshot, connection, refresh } = useRoomState(code, "instructor");
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (path: string, body?: unknown, method: "POST" | "DELETE" = "POST") => {
      setError(null);
      try {
        await api(path, { method, body, code, role: "instructor" });
        refresh();
        return true;
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "That action did not work.");
        refresh();
        return false;
      }
    },
    [code, refresh],
  );

  if (connection === "denied") {
    // A captive portal or a filtered request can produce a single 403 mid-class.
    // Offer a way back into the room rather than a dead end.
    return (
      <main className="page page-narrow stack">
        <h1 style={{ fontSize: 24 }}>Instructor access needed</h1>
        <p className="muted">
          This browser is not signed in as the instructor for class <strong>{code}</strong>. If you
          were teaching a moment ago, this is usually a network hiccup — try again. Otherwise open
          the console on the device that started the class, or use the instructor link you saved.
        </p>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={refresh}>
            Try again
          </button>
          <Link className="btn" href="/">
            Back to start
          </Link>
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="page">
        <p className="muted">Loading your class…</p>
      </main>
    );
  }

  const ended = snapshot.room.status === "ended";

  return (
    <main className="page stack">
      <header className="row-between">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1 style={{ fontSize: 22 }}>{snapshot.room.title}</h1>
          <p className="tiny muted">
            {snapshot.presentCount} here now · {snapshot.joinedCount} joined in total
          </p>
        </div>
        <div className="row">
          <ConnectionBadge connection={connection} />
          <Link className="btn btn-sm" href={`/r/${code}/summary`}>
            Summary
          </Link>
        </div>
      </header>

      {ended ? (
        <div className="notice" role="status">
          This class has ended. Learners can no longer join or respond, and the summary is still
          available.
        </div>
      ) : null}

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="console-grid">
        <div className="stack">
          <PollPanel snapshot={snapshot} disabled={ended} act={act} code={code} />
          <QuestionQueue questions={snapshot.questions} disabled={ended} act={act} code={code} />
        </div>

        <div className="stack">
          <PresentationPanel
            code={code}
            publicMode={snapshot.room.publicMode}
            polls={snapshot.polls}
            hasPick={snapshot.picks.length > 0}
            ended={ended}
            disabled={ended}
            act={act}
          />
          <InvitePanel code={code} joinUrl={joinUrl} qr={qr} hostToken={hostToken} />
          <PulsePanel pulse={snapshot.pulse} disabled={ended} act={act} code={code} />
          <PickerPanel picks={snapshot.picks} disabled={ended} act={act} code={code} />
          {snapshot.aiEnabled ? <ClassReadPanel code={code} disabled={ended} /> : null}
          <RosterPanel roster={snapshot.roster} />
          {!ended ? (
            <button
              className="btn btn-danger btn-block"
              onClick={() => {
                if (window.confirm("End this class? Learners will no longer be able to respond.")) {
                  void act(`/api/rooms/${code}/end`);
                }
              }}
            >
              End class
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export type HostAction = (
  path: string,
  body?: unknown,
  method?: "POST" | "DELETE",
) => Promise<boolean>;
