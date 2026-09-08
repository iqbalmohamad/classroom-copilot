"use client";

import { useState } from "react";
import type { PublicMode } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Everything needed to get learners into the room, plus control of what the
 * shared screen displays.
 *
 * The instructor link is deliberately behind a disclosure: it is a credential,
 * not a join link, and the difference has to be obvious at a glance.
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
  origin,
  hostToken,
  publicMode,
  disabled,
  act,
}: {
  code: string;
  joinUrl: string;
  qr: string | null;
  origin: string;
  hostToken: string | null;
  publicMode: PublicMode;
  disabled: boolean;
  act: HostAction;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showHostLink, setShowHostLink] = useState(false);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }

  const hostLink = hostToken ? `${origin}/api/rooms/${code}/claim?t=${hostToken}` : null;

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Invite &amp; screen
      </div>

      <div className="row-between">
        <div className="stack-sm" style={{ gap: 4 }}>
          <span className="code-display">{code}</span>
          <span className="join-url">{joinUrl}</span>
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
        <button className="btn btn-sm" onClick={() => copy("link", joinUrl)}>
          {copied === "link" ? "Copied" : "Copy join link"}
        </button>
      </div>

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
          shows the roster or who answered what.
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
                  Opens this console on another device. Anyone with this link controls the class —
                  do not put it on the screen or in the chat.
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
