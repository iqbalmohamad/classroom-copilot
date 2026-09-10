"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { SectionBar } from "@/components/host/SectionBar";
import { ActivityPanel } from "@/components/host/ActivityPanel";
import { ResponsesPanel } from "@/components/host/ResponsesPanel";
import { TimerPanel } from "@/components/host/TimerPanel";
import { MaterialsPanel } from "@/components/host/MaterialsPanel";
import { PlanPanel } from "@/components/host/PlanPanel";
import { TimerChip } from "@/components/TimerChip";

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
  const router = useRouter();
  const { snapshot, connection, refresh } = useRoomState(code, "instructor");
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const act = useCallback(
    async (path: string, body?: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") => {
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

  /**
   * End the class, then go to the summary — in that order, and only in that
   * order. Navigation happens on the server's confirmed success, never
   * optimistically, and nothing here marks the room ended locally: the room
   * state a surface shows always comes from the server snapshot, so a failed
   * request cannot leave this console (or anyone's phone) believing the class
   * ended when it did not.
   */
  const endClass = useCallback(async () => {
    if (!window.confirm("End this class? Learners will no longer be able to respond.")) return;
    setEnding(true);
    setError(null);
    try {
      // The server treats ending an already-ended class as success, so a retry
      // whose first attempt actually landed still reaches the summary.
      await api(`/api/rooms/${code}/end`, { method: "POST", code, role: "instructor" });
      router.push(`/r/${code}/summary`);
    } catch (err) {
      setEnding(false);
      // Always say what failed and that the class is still running; add the
      // server's own reason when there is one, because "no network" and "this
      // browser is no longer signed in as the instructor" need different fixes.
      const detail = err instanceof ApiRequestError ? ` ${err.message}` : " Try again.";
      setError(`Could not end the class — you are still live.${detail}`);
      refresh();
    }
  }, [code, refresh, router]);

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
  const reviewingActivity = reviewing
    ? snapshot.activities.find((activity) => activity.id === reviewing) ?? null
    : null;

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
          {snapshot.timer ? <TimerChip timer={snapshot.timer} /> : null}
          <ConnectionBadge connection={connection} />
          <Link className="btn btn-sm" href={`/r/${code}/summary`}>
            Summary
          </Link>
        </div>
      </header>

      <SectionBar
        code={code}
        sections={snapshot.sections}
        currentId={snapshot.room.currentSectionId}
        disabled={ended}
        act={act}
      />

      {ended ? (
        <div className="notice" role="status">
          This class has ended. Learners can no longer join or respond, and the summary is still
          available.
        </div>
      ) : null}

      {/* Errors here are about acting on a live class ("could not end the
          class — you are still live"). Once the snapshot says the class HAS
          ended — an end whose response was lost, then discovered by refresh —
          such an error is stale and now false, so the ended notice wins. */}
      {error && !ended ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="console-grid">
        <div className="stack">
          <PollPanel snapshot={snapshot} disabled={ended} act={act} code={code} />
          <ActivityPanel
            code={code}
            activities={snapshot.activities}
            sections={snapshot.sections}
            disabled={ended}
            act={act}
            onReview={setReviewing}
          />
          {reviewingActivity ? (
            <ResponsesPanel
              code={code}
              activity={reviewingActivity}
              version={snapshot.version}
              disabled={ended}
              act={act}
              onClose={() => setReviewing(null)}
            />
          ) : null}
          <QuestionQueue
            questions={snapshot.questions}
            sections={snapshot.sections}
            disabled={ended}
            act={act}
            code={code}
          />
        </div>

        <div className="stack">
          <PresentationPanel
            code={code}
            publicMode={snapshot.room.publicMode}
            polls={snapshot.polls}
            hasPick={snapshot.picks.length > 0}
            hasActivity={snapshot.activities.some((activity) => activity.status !== "draft")}
            hasRevealedResponse={snapshot.room.publicMode === "response"}
            ended={ended}
            disabled={ended}
            act={act}
          />
          <InvitePanel
            code={code}
            title={snapshot.room.title}
            joinUrl={joinUrl}
            qr={qr}
            hostToken={hostToken}
          />
          <TimerPanel
            code={code}
            timer={snapshot.timer}
            activities={snapshot.activities}
            disabled={ended}
            act={act}
          />
          <PulsePanel
            round={snapshot.pulseRound}
            history={snapshot.pulseHistory}
            disabled={ended}
            act={act}
            code={code}
          />
          <PickerPanel picks={snapshot.picks} disabled={ended} act={act} code={code} />
          <MaterialsPanel
            code={code}
            materials={snapshot.materials}
            sections={snapshot.sections}
            currentSectionId={snapshot.room.currentSectionId}
            disabled={ended}
            act={act}
          />
          {snapshot.aiEnabled ? <ClassReadPanel code={code} disabled={ended} /> : null}
          <RosterPanel roster={snapshot.roster} />
          <PlanPanel code={code} disabled={ended} act={act} />
          {!ended ? (
            <button
              className="btn btn-danger btn-block"
              disabled={ending}
              onClick={() => void endClass()}
            >
              {ending ? "Ending…" : "End class"}
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
  method?: "POST" | "PATCH" | "DELETE",
) => Promise<boolean>;
