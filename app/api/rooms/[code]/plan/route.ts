import { savePlan } from "@/lib/plans";
import { savePlanSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save this room's preparation as a reusable plan.
 *
 * The response carries the plan token exactly once — it is stored only as a
 * digest, so it cannot be re-read later, and the console keeps it the same way
 * it keeps the instructor link.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { title } = await readJson(req, savePlanSchema);
    return ok(await savePlan(room, title));
  });
}
