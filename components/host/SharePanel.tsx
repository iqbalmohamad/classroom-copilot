"use client";

import { useEffect, useState } from "react";
import type { PublicMode } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Everything needed to get learners into the room, plus control of what the
 * shared screen displays.
 *
 * The instructor link is behind a disclosure and labelled as a credential, not
 * a join link — the difference has to be obvious at a glance, because pasting
 * the wrong one into a cohort chat hands the class to everyone in it.
 */
const MODES: { value: PublicMode; label: string }[] = [
  { value: "join", label: "Join screen" },
  { value: "poll", label: "Question" },
  { value: "results", label: "Results" },
  { value: "pick", label: "Picked learner" },
  { value: "waiting", label: "Blank" },
];

export function SharePanel({
  code,
  joinUrl,
  qr,
  hostToken,
  publicMode,
  disabled,
  act,
}: {
  code: string;
  joinUrl: string;
  qr: string | null;
  hostToken: string | null;
  publicMode: PublicMode;
  disabled: boolean;
  act: HostAction;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const [showHostLink, setShowHostLink] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);

  // The browser's own origin is the one address that cannot be spoofed by a
  // forwarded-host header, so links the instructor copies are built from it.
  useEffect(() => setOrigin(window.location.origin), []);

  const shareUrl = origin ? `${origin}/r/${code}` : joinUrl;
  const hostLink = hostToken && origin
    ? `${origin}/api/rooms/${code}/claim?t=${encodeURIComponent(hostToken)}`
    : null;

  async function copy(label: string, text: string) {
    setCopied(null);
    setCopyFailed(null);
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    } catch {
      // Silently doing nothing is the dangerous failure: the instructor pastes
      // whatever was on the clipboard before into the cohort chat. Say so, and
      // show the text so it can be selected by hand.
      setCopyFailed(label);
    }
  }

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Invite &amp; screen
      </div>

      <div className="row-between">
        <div className="stack-sm" style={{ gap: 4 }}>
          <span className="code-display">{code}</span>
          <span className="join-url">{shareUrl}</span>
        </div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR code linking to ${joinUrl}`} width={96} height={96} />
        ) : null}
      </div>

      <div className="btn-group">
        <button className="btn btn-sm" onClick={() => copy("code", code)}>
          {copied === "code" ? "Copied" : "Copy code"}
        </button>
        <button className="btn btn-sm" onClick={() => copy("link", shareUrl)}>
          {copied === "link" ? "Copied" : "Copy join link"}
        </button>
      </div>

      {copyFailed ? (
        <div className="notice notice-error" role="alert">
          <p className="small">This browser would not let us copy. Select and copy it by hand:</p>
          <p className="join-url" style={{ userSelect: "all", marginTop: 6 }}>
            {copyFailed === "code" ? code : copyFailed === "link" ? shareUrl : hostLink}
          </p>
        </div>
      ) : null}

      <hr className="divider" />

      <div className="stack-sm">
        <span className="label">Shared screen shows</span>
        <div className="btn-group">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              className={`btn btn-sm ${publicMode === mode.value ? "btn-primary" : ""}`}
              disabled={disabled}
              aria-pressed={publicMode === mode.value}
              onClick={() => act(`/api/rooms/${code}/public-mode`, { mode: mode.value })}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="tiny muted">
          Opening or revealing a poll switches the screen automatically. The shared screen never
          shows the roster, and shows a learner&apos;s name only while it is on Picked learner.
        </p>
      </div>

      {hostLink ? (
        <>
          <hr className="divider" />
          <div className="stack-sm">
            <button
              className="btn btn-sm"
              onClick={() => setShowHostLink((value) => !value)}
              aria-expanded={showHostLink}
            >
              {showHostLink ? "Hide instructor link" : "Instructor link (keep private)"}
            </button>
            {showHostLink ? (
              <>
                <p className="tiny muted">
                  Save this if you might need the console on another device — it is the only way
                  back in if this browser forgets the class. Anyone with this link controls the
                  class, so keep it out of the shared screen and out of the cohort chat.
                </p>
                <button className="btn btn-sm" onClick={() => copy("host", hostLink)}>
                  {copied === "host" ? "Copied" : "Copy instructor link"}
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
