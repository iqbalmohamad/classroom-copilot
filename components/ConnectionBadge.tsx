"use client";

import type { Connection } from "@/lib/client/useRoomState";

/**
 * Honest connection state.
 *
 * "Live" and "Syncing" are both fully working transports — the badge tells the
 * instructor the difference so that, if something looks stale mid-class, they
 * know whether to trust the screen or reload.
 */
const COPY: Record<Connection, { label: string; className: string }> = {
  connecting: { label: "Connecting", className: "chip" },
  live: { label: "Live", className: "chip chip-live" },
  polling: { label: "Syncing", className: "chip chip-warn" },
  offline: { label: "Offline", className: "chip chip-bad" },
  denied: { label: "No access", className: "chip chip-bad" },
};

export function ConnectionBadge({ connection }: { connection: Connection }) {
  const { label, className } = COPY[connection];
  return (
    <span className={className} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}
