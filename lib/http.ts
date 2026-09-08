import { NextResponse } from "next/server";

/**
 * Uniform API responses.
 *
 * Errors are returned as `{ error: { code, message } }` with a message that is
 * safe to render directly in the classroom UI — no stack traces, no database
 * detail, no internal identifiers.
 */
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "rate_limited"
  | "unavailable"
  | "server_error";

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  rate_limited: 429,
  unavailable: 503,
  server_error: 500,
};

export function ok<T extends object>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function fail(code: ApiErrorCode, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS[code], headers: { "cache-control": "no-store" } },
  );
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Wraps a route handler so unexpected failures never leak internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message);
    console.error("[api]", error);
    return fail("server_error", "Something went wrong. Please try again.");
  }
}

export async function readJson<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("bad_request", "Expected a JSON body.");
  }
  try {
    return schema.parse(raw);
  } catch {
    throw new ApiError("bad_request", "That input was not valid.");
  }
}
