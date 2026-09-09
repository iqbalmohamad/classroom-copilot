import { actOnActivity, updateActivity } from "@/lib/workflow";
import { activityActionSchema, updateActivitySchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string; activityId: string }> };

/** Edit a prepared activity. Refused once anyone has answered it. */
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { code, activityId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, updateActivitySchema);
    await updateActivity(room, activityId, input);
    return ok({ updated: true });
  });
}

/** open · close · again (a fresh attempt) · delete (only while unanswered). */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { code, activityId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { action } = await readJson(req, activityActionSchema);
    return ok(await actOnActivity(room, activityId, action));
  });
}
