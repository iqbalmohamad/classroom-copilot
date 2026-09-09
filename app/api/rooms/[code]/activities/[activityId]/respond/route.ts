import { submitActivityResponse } from "@/lib/workflow";
import { submitActivitySchema } from "@/lib/validation";
import { fail, handle, ok, readJson } from "@/lib/http";
import { clientKey, loadRoom, requireParticipant } from "@/lib/route-context";
import { allow, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Learner submits or edits their own answer.
 *
 * One row per (activity, learner): editing replaces, it never adds a second
 * submission, and the row belongs to the learner who wrote it.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; activityId: string }> },
) {
  return handle(async () => {
    const { code, activityId } = await ctx.params;
    const room = await loadRoom(code);
    const participant = await requireParticipant(req, room);

    if (!allow(clientKey(req, `activity:${participant.id}`), LIMITS.respond)) {
      return fail("rate_limited", "That is a lot of edits at once. Give it a moment.");
    }

    const { answers } = await readJson(req, submitActivitySchema);
    const result = await submitActivityResponse(room, activityId, participant.id, answers);
    return ok(result);
  });
}
