import "server-only";
import { cookies } from "next/headers";
import { sql } from "./db";
import { tokenMatches } from "./ids";
import { isProduction } from "./env";

/**
 * Authorisation model
 * -------------------
 * Two completely separate bearer tokens, each 32 random bytes, each stored only
 * as a SHA-256 digest:
 *
 *   host token         proves "I created this room"  -> instructor powers
 *   participant token  proves "I am this learner"    -> learner powers
 *
 * A room code proves nothing on its own. It is printed on a projector and
 * shouted across a classroom, so every instructor route verifies the host token
 * against `rooms.host_token_hash` and every learner route resolves a
 * participant row. There is no route that upgrades one token into the other.
 *
 * Tokens travel in httpOnly cookies scoped per room. Because a phone can lose
 * its cookies mid-class (private tabs, storage pressure, "clear data"), clients
 * also keep a copy in localStorage and may present it in an `x-cc-*-token`
 * header. That is a deliberate reliability trade-off for a 90-minute class:
 * an XSS on our own origin could already act as the user via same-origin
 * fetches, so the header fallback does not meaningfully widen the blast radius.
 */

export const HOST_COOKIE_PREFIX = "cc_host_";
export const PARTICIPANT_COOKIE_PREFIX = "cc_learner_";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // a long teaching day

export function hostCookieName(code: string): string {
  return `${HOST_COOKIE_PREFIX}${code}`;
}

export function participantCookieName(code: string): string {
  return `${PARTICIPANT_COOKIE_PREFIX}${code}`;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export interface RoomRow {
  id: string;
  code: string;
  title: string;
  host_token_hash: string;
  status: "open" | "ended";
  public_mode: "join" | "poll" | "results" | "pick" | "waiting";
  version: string | number;
  created_at: Date;
  ended_at: Date | null;
}

export interface ParticipantRow {
  id: string;
  room_id: string;
  display_name: string;
  pulse: "got_it" | "shaky" | "lost" | null;
  joined_at: Date;
}

export async function findRoom(code: string): Promise<RoomRow | null> {
  if (!code) return null;
  const rows = await sql<RoomRow[]>`
    select id, code, title, host_token_hash, status, public_mode, version, created_at, ended_at
    from rooms where code = ${code} limit 1`;
  return rows[0] ?? null;
}

async function readToken(cookieName: string, headerName: string, req: Request) {
  const fromHeader = req.headers.get(headerName);
  if (fromHeader) return fromHeader;
  const jar = await cookies();
  return jar.get(cookieName)?.value ?? null;
}

/** Resolves the caller as the instructor of `room`, or null. */
export async function resolveHost(req: Request, room: RoomRow): Promise<boolean> {
  const token = await readToken(hostCookieName(room.code), "x-cc-host-token", req);
  if (!token) return false;
  return tokenMatches(token, room.host_token_hash);
}

/** Resolves the caller as a learner in `room`, or null. */
export async function resolveParticipant(
  req: Request,
  room: RoomRow,
): Promise<ParticipantRow | null> {
  const token = await readToken(participantCookieName(room.code), "x-cc-learner-token", req);
  if (!token) return null;

  // Look the row up by digest so the raw token never reaches a query predicate
  // in plaintext form, and so a wrong token simply finds nothing.
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(token).digest("hex");

  const rows = await sql<ParticipantRow[]>`
    select id, room_id, display_name, pulse, joined_at
    from participants
    where room_id = ${room.id} and token_hash = ${digest}
    limit 1`;
  return rows[0] ?? null;
}

/** Heartbeat. Deliberately does not bump the room version (see 0001_init.sql). */
export async function touchParticipant(participantId: string): Promise<void> {
  await sql`update participants set last_seen_at = now() where id = ${participantId}`;
}
