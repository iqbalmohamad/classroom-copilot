import { startTimer } from "@/lib/workflow";
import { startTimerSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start an activity or break timer.
 *
 * The deadline is stored, so every surface counts down from the same instant
 * and a refresh costs nobody a second.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, startTimerSchema);
    return ok(await startTimer(room, input));
  });
}
