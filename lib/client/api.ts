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
export async function api<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    code?: string;
    role?: Role;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { method = "GET", body, code, role = "public", signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(code ? authHeaders(code, role) : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiRequestError(0, "offline", "No connection. Check your network and try again.");
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
