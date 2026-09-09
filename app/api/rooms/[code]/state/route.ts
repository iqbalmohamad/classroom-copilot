import { handle, ok, fail } from "@/lib/http";
import { loadRoom } from "@/lib/route-context";
import { buildSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Role-scoped snapshot of the room.
 *
 * This is both the initial load for every surface and the fallback transport
 * when the event stream is unavailable, so it is intentionally cheap and
 * idempotent.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const url = new URL(req.url);
    const role = url.searchParams.get("role") ?? "public";
    if (role !== "instructor" && role !== "learner" && role !== "public") {
      return fail("bad_request", "Unknown view.");
    }

    const room = await loadRoom(code);
    const snapshot = await buildSnapshot(req, room, role, { heartbeat: true });
    return ok({ snapshot });
  });
}
