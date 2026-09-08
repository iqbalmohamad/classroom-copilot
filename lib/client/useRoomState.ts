"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "./api";
import type { InstructorSnapshot, LearnerSnapshot, PublicSnapshot, Role } from "../types";

/**
 * Live room state for one surface.
 *
 * Transport, in order of preference:
 *
 *   1. Server-sent events. The server pushes a fresh role-scoped snapshot
 *      whenever the room version changes, so updates land well under a second
 *      without the client hammering the database.
 *   2. Polling. If the stream cannot be established, is cut by a proxy, or goes
 *      quiet, the hook transparently switches to fetching /state on a short
 *      interval. The classroom keeps working, it just costs a little latency.
 *      This is what makes the app safe on an unknown venue network — and it is
 *      also the path used when a browser has lost its cookies, since polling
 *      can present the token as a header and EventSource cannot.
 *
 * Regardless of transport, the hook re-syncs immediately when the tab becomes
 * visible again or the device comes back online: a phone that has been in a
 * pocket for ten minutes must never come back showing a stale question.
 */

type SnapshotFor<R extends Role> = R extends "instructor"
  ? InstructorSnapshot
  : R extends "learner"
    ? LearnerSnapshot
    : PublicSnapshot;

export type Connection = "connecting" | "live" | "polling" | "offline" | "denied";

export interface RoomState<R extends Role> {
  snapshot: SnapshotFor<R> | null;
  connection: Connection;
  error: string | null;
  /** Force an immediate re-fetch; used right after the client mutates state. */
  refresh: () => void;
}

/** No stream traffic for this long means the stream is no longer trustworthy. */
const STREAM_SILENCE_MS = 25_000;
const POLL_INTERVAL_MS = 1_500;
/** How often to retry the stream once we have fallen back to polling. */
const STREAM_RETRY_MS = 20_000;
/** Belt-and-braces re-sync even when the stream looks healthy. */
const RECONCILE_MS = 30_000;

export function useRoomState<R extends Role>(code: string, role: R): RoomState<R> {
  const [snapshot, setSnapshot] = useState<SnapshotFor<R> | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const lastMessageRef = useRef<number>(Date.now());
  const lastPayloadRef = useRef<string>("");
  const stoppedRef = useRef(false);
  const pollingRef = useRef(false);
  const deniedRef = useRef(false);
  const cyclingUntilRef = useRef(0);
  const refreshRef = useRef<() => void>(() => {});

  /**
   * Snapshots arrive both from the stream and from reconcile fetches, and most
   * of them are identical. Comparing the serialised form keeps React from
   * re-rendering the console (and stealing focus from the question box) twenty
   * times a minute for no reason.
   */
  const applySnapshot = useCallback((next: unknown, serialised?: string) => {
    const payload = serialised ?? JSON.stringify(next);
    if (payload === lastPayloadRef.current) return;
    lastPayloadRef.current = payload;
    setSnapshot(next as SnapshotFor<R>);
    setError(null);
  }, []);

  const fetchOnce = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      try {
        const result = await api<{ snapshot: unknown }>(`/api/rooms/${code}/state?role=${role}`, {
          code,
          role,
          signal,
        });
        deniedRef.current = false;
        applySnapshot(result.snapshot);
        lastMessageRef.current = Date.now();
        return true;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return false;
        if (err instanceof ApiRequestError) {
          if (err.status === 401 || err.status === 403 || err.status === 404) {
            deniedRef.current = true;
            setConnection("denied");
            setError(err.message);
            return false;
          }
          if (err.status === 0) {
            setConnection("offline");
            return false;
          }
          setError(err.message);
        }
        return false;
      }
    },
    [applySnapshot, code, role],
  );

  useEffect(() => {
    stoppedRef.current = false;
    deniedRef.current = false;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      pollingRef.current = false;
    };

    const closeStream = () => {
      const source = sourceRef.current;
      sourceRef.current = null;
      source?.close();
    };

    const startPolling = () => {
      if (pollingRef.current || stoppedRef.current || deniedRef.current) return;
      pollingRef.current = true;
      setConnection((current) => (current === "denied" ? current : "polling"));
      void fetchOnce(controller.signal);
      pollTimer = setInterval(() => {
        if (deniedRef.current) {
          stopPolling();
          return;
        }
        void fetchOnce(controller.signal);
      }, POLL_INTERVAL_MS);

      // Keep trying to get the cheaper, lower-latency transport back.
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (!stoppedRef.current && !deniedRef.current) openStream();
      }, STREAM_RETRY_MS);
    };

    const openStream = () => {
      if (stoppedRef.current || deniedRef.current) return;
      closeStream();

      // No token in the URL: EventSource cannot set headers, so the stream
      // relies on the httpOnly cookie. A browser without that cookie simply
      // fails over to polling, which can authenticate with a header.
      let source: EventSource;
      try {
        source = new EventSource(`/api/rooms/${code}/stream?role=${role}`);
      } catch {
        startPolling();
        return;
      }
      sourceRef.current = source;

      source.addEventListener("state", (event) => {
        lastMessageRef.current = Date.now();
        stopPolling();
        if (retryTimer) clearTimeout(retryTimer);
        setConnection("live");
        const raw = (event as MessageEvent<string>).data;
        try {
          applySnapshot(JSON.parse(raw), raw);
        } catch {
          /* malformed frame: the next one corrects it */
        }
      });

      // Liveness without a state change, so a quiet room is not mistaken for a
      // dead connection. (SSE comment frames are invisible to EventSource.)
      source.addEventListener("ping", () => {
        lastMessageRef.current = Date.now();
        setConnection((current) => (current === "live" ? current : "live"));
      });

      // The server ends each stream well before any platform timeout and asks
      // us to come straight back; that reconnect is also a free full re-sync.
      source.addEventListener("cycle", () => {
        lastMessageRef.current = Date.now();
        cyclingUntilRef.current = Date.now() + 3_000;
        closeStream();
        if (!stoppedRef.current) openStream();
      });

      source.onerror = () => {
        closeStream();
        if (stoppedRef.current) return;

        // An expected end-of-cycle close is not a failure.
        if (Date.now() < cyclingUntilRef.current) {
          openStream();
          return;
        }

        // A stream that is refused (missing cookie, unknown room) keeps being
        // refused, so confirm with a normal request: that tells "denied" apart
        // from "flaky network" and lands us on the right fallback.
        void fetchOnce(controller.signal).then(() => {
          if (!stoppedRef.current) startPolling();
        });
      };
    };

    const resync = () => {
      if (stoppedRef.current || deniedRef.current) return;
      lastMessageRef.current = Date.now();
      void fetchOnce(controller.signal);
      if (!sourceRef.current) openStream();
    };

    refreshRef.current = () => {
      void fetchOnce(controller.signal);
    };

    // First paint must not wait for a stream handshake.
    void fetchOnce(controller.signal);
    openStream();

    const watchdog = setInterval(() => {
      if (stoppedRef.current || deniedRef.current) return;
      const silence = Date.now() - lastMessageRef.current;
      if (silence > STREAM_SILENCE_MS) {
        closeStream();
        startPolling();
      }
    }, 5_000);

    const reconcile = setInterval(() => {
      if (stoppedRef.current || pollingRef.current || deniedRef.current) return;
      if (document.visibilityState !== "visible") return;
      void fetchOnce(controller.signal);
    }, RECONCILE_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    const onOnline = () => resync();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onVisible);

    return () => {
      stoppedRef.current = true;
      controller.abort();
      closeStream();
      stopPolling();
      clearInterval(watchdog);
      clearInterval(reconcile);
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [applySnapshot, code, fetchOnce, role]);

  const refresh = useCallback(() => refreshRef.current(), []);

  return { snapshot, connection, error, refresh };
}
