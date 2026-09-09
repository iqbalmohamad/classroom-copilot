import { reorderActivities } from "@/lib/workflow";
import { reorderActivitiesSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The order prepared activities are run in, and the order a plan preserves. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { order } = await readJson(req, reorderActivitiesSchema);
    await reorderActivities(room, order);
    return ok({ reordered: order.length });
  });
}
