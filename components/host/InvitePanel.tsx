"use client";

import { useEffect, useState } from "react";

/**
 * How learners get in — and, kept deliberately apart from it, how the
 * instructor gets back in.
 *
 * The two links look alike and do opposite things: one is meant for the cohort
 * chat, the other hands over control of the class to anyone holding it. So the
 * learner half is the body of the panel and the instructor half is a separate,
 * labelled block behind a disclosure. Controlling the presentation screen is a
 * different job and lives in its own panel.
 */
export function InvitePanel({
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
        Invite learners
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

      <p className="tiny muted" style={{ margin: 0 }}>
        Safe to post in the cohort chat. The presentation screen shows the same code and QR.
      </p>

      {copyFailed ? (
        <div className="notice notice-error" role="alert">
          <p className="small">This browser would not let us copy. Select and copy it by hand:</p>
          <p className="join-url" style={{ userSelect: "all", marginTop: 6 }}>
            {copyFailed === "code" ? code : copyFailed === "link" ? shareUrl : hostLink}
          </p>
        </div>
      ) : null}

      {hostLink ? (
        <>
          <hr className="divider" />
          <div className="stack-sm">
            <span className="subhead">Instructor access — keep private</span>
            <p className="tiny muted" style={{ margin: 0 }}>
              Not a join link. Anyone who opens it controls this class.
            </p>
            <div>
              <button
                className="btn btn-sm"
                onClick={() => setShowHostLink((value) => !value)}
                aria-expanded={showHostLink}
              >
                {showHostLink ? "Hide instructor link" : "Show instructor link"}
              </button>
            </div>
            {showHostLink ? (
              <>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Save this if you might need the console on another device — it is the only way
                  back in if this browser forgets the class. Keep it off the presentation screen
                  and out of the cohort chat.
                </p>
                <div>
                  <button className="btn btn-sm" onClick={() => copy("host", hostLink)}>
                    {copied === "host" ? "Copied" : "Copy instructor link"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
