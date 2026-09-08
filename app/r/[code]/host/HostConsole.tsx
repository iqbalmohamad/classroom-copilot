"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiRequestError } from "@/lib/client/api";
import { hostToken } from "@/lib/client/tokens";
import { useRoomState } from "@/lib/client/useRoomState";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { SharePanel } from "@/components/host/SharePanel";
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
 * work the queue), the right column is what they read (who is here, how the
 * class feels, what the projector is showing).
 */
export function HostConsole({
  code,
  joinUrl,
  qr,
  origin,
}: {
  code: string;
  joinUrl: string;
  qr: string | null;
  origin: string;
}) {
  const { snapshot, connection, refresh } = useRoomState(code, "instructor");
  const [error, setError] = useState<string | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);

  useEffect(() => {
    setSavedToken(hostToken.get(code));
  }, [code]);

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
    return (
      <main className="page page-narrow stack">
        <h1 style={{ fontSize: 24 }}>Instructor access needed</h1>
        <p className="muted">
          This browser is not signed in as the instructor for class <strong>{code}</strong>. Open
          the console from the device that started the class, or use the instructor link you saved.
        </p>
        <Link className="btn" href="/">
          Back to start
        </Link>
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
          <Link className="btn btn-sm" href={`/r/${code}/screen`} target="_blank">
            Open screen view
          </Link>
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
          <SharePanel
            code={code}
            joinUrl={joinUrl}
            qr={qr}
            origin={origin}
            hostToken={savedToken}
            publicMode={snapshot.room.publicMode}
            disabled={ended}
            act={act}
          />
          <PulsePanel pulse={snapshot.pulse} disabled={ended} act={act} code={code} />
          <PickerPanel picks={snapshot.picks} disabled={ended} act={act} code={code} />
          {snapshot.aiEnabled ? <ClassReadPanel code={code} disabled={ended} /> : null}
          <RosterPanel roster={snapshot.roster} hasActivePoll={snapshot.activePoll !== null} />
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
