import { actOnPoll } from "@/lib/service";
import { pollActionSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instructor-only poll lifecycle: open, close, reveal, hide. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; pollId: string }> },
) {
  return handle(async () => {
    const { code, pollId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { action } = await readJson(req, pollActionSchema);
    await actOnPoll(room, pollId, action);
    return ok({ action });
  });
}
