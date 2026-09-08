import { findRoom, touchParticipant, resolveParticipant, type RoomRow } from "@/lib/auth";
import { fail } from "@/lib/http";
import { loadRoom } from "@/lib/route-context";
import { buildSnapshot } from "@/lib/snapshot";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Serverless platforms cap streaming responses; we close first and let the
 *  browser's EventSource reconnect, which also re-syncs state for free. */
export const maxDuration = 60;

const POLL_INTERVAL_MS = 400;
const HEARTBEAT_MS = 15_000;
/** Re-emit even without a version change so derived data (presence) stays fresh. */
const REFRESH_MS = 10_000;
const MAX_LIFETIME_MS = 50_000;

/**
 * Server-sent events carrying role-scoped snapshots.
 *
 * The loop watches a single indexed counter (`rooms.version`, bumped by
 * database triggers) rather than subscribing to change feeds, which keeps the
 * transport compatible with a plain connection pooler and with any Postgres
 * host. Clients fall back to polling `/state` automatically if this stream is
 * unavailable, so a proxy that buffers SSE degrades rather than breaks.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = new URL(req.url);
  const role = url.searchParams.get("role") ?? "public";
  if (role !== "instructor" && role !== "learner" && role !== "public") {
    return fail("bad_request", "Unknown view.");
  }

  let room: RoomRow;
  try {
    room = await loadRoom(code);
  } catch {
    return fail("not_found", "That class code was not found.");
  }

  // Authorise once, up front: a rejected stream must fail loudly rather than
  // hang open with nothing on it.
  let first: unknown;
  try {
    first = await buildSnapshot(req, room, role as Role, { heartbeat: true });
  } catch (error) {
    const reason = (error as { code?: string }).code;
    if (reason === "forbidden") return fail("forbidden", "Instructor access is required.");
    if (reason === "unauthorized") return fail("unauthorized", "Join the class again to continue.");
    return fail("server_error", "Could not open the live connection.");
  }

  const participant = role === "learner" ? await resolveParticipant(req, room) : null;
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastPayload = "";
      let lastEmit = 0;
      let lastHeartbeatSent = Date.now();
      let lastPresenceTouch = Date.now();

      const send = (event: string, data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      const emit = (snapshot: unknown) => {
        const payload = JSON.stringify(snapshot);
        if (payload === lastPayload) return;
        lastPayload = payload;
        lastEmit = Date.now();
        send("state", payload);
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      req.signal.addEventListener("abort", finish);

      // Tell the browser how quickly to come back after we close.
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      emit(first);

      try {
        while (!closed && !req.signal.aborted) {
          await sleep(POLL_INTERVAL_MS);
          if (closed || req.signal.aborted) break;

          if (Date.now() - startedAt > MAX_LIFETIME_MS) {
            send("cycle", "{}");
            break;
          }

          // Server-side presence: while this connection is alive the learner is
          // in the room, regardless of whether their phone is throttling timers.
          if (participant && Date.now() - lastPresenceTouch > 15_000) {
            lastPresenceTouch = Date.now();
            await touchParticipant(participant.id);
          }

          const fresh = await findRoom(room.code);
          if (!fresh) break;

          const changed = Number(fresh.version) !== Number(room.version);
          const stale = Date.now() - lastEmit > REFRESH_MS;

          if (changed || stale) {
            room = fresh;
            try {
              emit(await buildSnapshot(req, fresh, role as Role));
            } catch {
              // Access was revoked (room ended, learner removed): stop cleanly.
              break;
            }
          }

          if (Date.now() - lastHeartbeatSent > HEARTBEAT_MS) {
            lastHeartbeatSent = Date.now();
            // A named event, not a comment frame: EventSource silently drops
            // comments, so a quiet room would otherwise look like a dead
            // connection to the client's watchdog. The comment frame is still
            // sent as well, because it is what stops nginx-style proxies from
            // buffering the response.
            if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
            send("ping", "{}");
          }
        }
      } catch {
        /* fall through to close; the client will reconnect */
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      // Disables response buffering on nginx-style proxies.
      "x-accel-buffering": "no",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
