"use client";

import { authHeaders } from "./tokens";
import type { Role } from "../types";

export interface ApiFailure {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Single place where the browser talks to the server.
 *
 * Every call carries the caller's token as a header in addition to the cookie,
 * and every failure arrives as an ApiRequestError with a message that is
 * already safe to show to a learner or an instructor mid-class.
 */
/** Venue wifi fails by stalling, not by refusing. Never wait forever. */
const REQUEST_TIMEOUT_MS = 12_000;

export async function api<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    code?: string;
    role?: Role;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const { method = "GET", body, code, role = "public", signal } = options;

  // Without this, a connection that opens but never responds leaves the calling
  // component stuck on "Opening…" with its button disabled for the rest of the
  // class, and the only way out is a page reload.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const composite =
    typeof AbortSignal !== "undefined" && "any" in AbortSignal && signal
      ? AbortSignal.any([signal, timeout.signal])
      : (signal ?? timeout.signal);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal: composite,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(code ? authHeaders(code, role) : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    // A caller-initiated abort (unmount, navigation) propagates untouched; our
    // own timeout becomes an ordinary, retryable transport failure.
    if ((error as Error)?.name === "AbortError" && !timeout.signal.aborted) throw error;
    if (timeout.signal.aborted) {
      throw new ApiRequestError(0, "timeout", "That took too long. Check your connection.");
    }
    throw new ApiRequestError(0, "offline", "No connection. Check your network and try again.");
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload = text ? safeParse(text) : {};

  if (!response.ok) {
    const failure = (payload as { error?: ApiFailure }).error;
    throw new ApiRequestError(
      response.status,
      failure?.code ?? "server_error",
      failure?.message ?? "Something went wrong. Please try again.",
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
