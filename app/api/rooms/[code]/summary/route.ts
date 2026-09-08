import { buildSummary } from "@/lib/summary";
import { handle, ok } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instructor-only. The summary contains roster-derived data and never leaves this route. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    return ok({ summary: await buildSummary(room) });
  });
}
