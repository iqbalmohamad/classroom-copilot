import { findRoom, touchParticipant, resolveParticipant, type RoomRow } from "@/lib/auth";
import { fail } from "@/lib/http";
import { openDatabaseScope } from "@/lib/db";
import { loadRoom } from "@/lib/route-context";
import { buildSnapshot } from "@/lib/snapshot";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Serverless platforms cap streaming responses; we close first and let the
 *  browser's EventSource reconnect, which also re-syncs state for free. */
export const maxDuration = 60;

/**
 * How often the loop checks the room version.
 *
 * Configurable because the right answer differs by host. Under Node a query is
 * a pooled round trip and 400ms is nearly free. On Cloudflare Workers every
 * query is a subrequest against a per-invocation budget, and the difference
 * between 400ms and 1000ms across a 90-minute class of forty is roughly 567,000
 * versus 227,000 queries. Updates still land well inside a second either way.
 */
function pollIntervalMs(): number {
  const parsed = Number.parseInt(process.env.CC_STREAM_POLL_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 100 ? Math.min(parsed, 5_000) : 400;
}

/** How long a stream lives before asking the browser to reconnect. */
function lifetimeMs(): number {
  const parsed = Number.parseInt(process.env.CC_STREAM_LIFETIME_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 5_000 ? Math.min(parsed, 240_000) : 50_000;
}

/** Comfortably inside the client's 35s silence budget, even if a tick is slow. */
const HEARTBEAT_MS = 10_000;
/** Re-emit even without a version change so derived data (presence) stays fresh. */
const REFRESH_MS = 10_000;

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
  // This connection has to outlive the handler, so the scope is opened here and
  // closed by the stream body — not by withRequestDatabase, whose lifetime ends
  // when the handler returns. Every early return below closes it explicitly;
  // forgetting one would strand a database connection for the whole class.
  const scope = openDatabaseScope();
  const refuse = async (...args: Parameters<typeof fail>) => {
    await scope.end();
    return fail(...args);
  };

  const { code } = await ctx.params;
  const url = new URL(req.url);
  const role = url.searchParams.get("role") ?? "public";
  if (role !== "instructor" && role !== "learner" && role !== "public") {
    return refuse("bad_request", "Unknown view.");
  }

  let room: RoomRow;
  try {
    room = await scope.run(() => loadRoom(code));
  } catch (error) {
    // Only a genuinely missing room is a 404. Reporting a pool timeout as
    // "class not found" would send an instructor hunting for a typo in a code
    // that is perfectly correct.
    if ((error as { code?: string }).code === "not_found") {
      return refuse("not_found", "That class code was not found.");
    }
    return refuse("unavailable", "Could not reach the class right now. Retrying.");
  }

  // Authorise once, up front: a rejected stream must fail loudly rather than
  // hang open with nothing on it.
  let first: unknown;
  try {
    first = await scope.run(() => buildSnapshot(req, room, role as Role, { heartbeat: true }));
  } catch (error) {
    const reason = (error as { code?: string }).code;
    if (reason === "forbidden") return refuse("forbidden", "Instructor access is required.");
    if (reason === "unauthorized") {
      return refuse("unauthorized", "Join the class again to continue.");
    }
    return refuse("server_error", "Could not open the live connection.");
  }

  const participant =
    role === "learner" ? await scope.run(() => resolveParticipant(req, room)) : null;
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const pollInterval = pollIntervalMs();
  const maxLifetime = lifetimeMs();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await scope.run(() => pump(controller));
      } finally {
        // The one place the streaming connection is released: reached on a
        // clean cycle, on client disconnect, and on any error in the loop.
        await scope.end();
      }
    },
    // Fired when the client goes away mid-stream without an abort signal.
    async cancel() {
      await scope.end();
    },
  });

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>) {
    {
      let closed = false;
      let lastPayload = "";
      // When we last *built* a snapshot, which is the expensive part. This is
      // deliberately not "when we last sent one": an unchanged room emits
      // nothing, and keying the refresh off emission would rebuild the
      // snapshot on every tick of a quiet room, for every connected client.
      let lastBuild = 0;
      let lastHeartbeatSent = Date.now();
      let lastPresenceTouch = Date.now();

      const send = (event: string, data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      const emit = (snapshot: unknown) => {
        const payload = JSON.stringify(snapshot);
        if (payload === lastPayload) return; // nothing the client does not have
        lastPayload = payload;
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
      lastBuild = Date.now();
      emit(first);

      try {
        while (!closed && !req.signal.aborted) {
          await sleep(pollInterval);
          if (closed || req.signal.aborted) break;

          if (Date.now() - startedAt > maxLifetime) {
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
          // Rebuild periodically even without a version change, so data derived
          // at read time (presence) does not go stale on an idle room.
          const stale = Date.now() - lastBuild > REFRESH_MS;

          if (changed || stale) {
            lastBuild = Date.now();
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
    }
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      // Disables response buffering on nginx-style proxies.
      "x-accel-buffering": "no",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
