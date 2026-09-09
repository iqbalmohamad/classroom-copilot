import { actOnTimer } from "@/lib/workflow";
import { timerActionSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** pause · resume · extend · end. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; timerId: string }> },
) {
  return handle(async () => {
    const { code, timerId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { action, seconds } = await readJson(req, timerActionSchema);
    await actOnTimer(room, timerId, action, seconds);
    return ok({ action });
  });
}
