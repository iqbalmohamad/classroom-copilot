import { activityResponses } from "@/lib/projections";
import { handle, ok } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The instructor's review list for one activity.
 *
 * Deliberately not part of the realtime snapshot: a class of forty pasting SQL
 * would push a megabyte to every connected client on every keystroke-save. The
 * console fetches this when the instructor opens a response list and re-fetches
 * when the room version moves, which is the same freshness at a fraction of the
 * cost — and it keeps named submissions on a route that requires the host token
 * rather than inside a payload that is built for other roles too.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string; activityId: string }> },
) {
  return handle(async () => {
    const { code, activityId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    return ok({ responses: await activityResponses(room, activityId) });
  });
}
