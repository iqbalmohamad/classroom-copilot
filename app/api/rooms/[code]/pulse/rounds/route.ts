import { startPulseRound } from "@/lib/service";
import { startPulseRoundSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a named pulse round, optionally against a section other than the
 * current one — which is what lets an instructor go back and ask the same
 * section again after re-explaining it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, startPulseRoundSchema);
    return ok(await startPulseRound(room, { label: input.label, sectionId: input.sectionId }));
  });
}
