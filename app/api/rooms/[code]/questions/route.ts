import { submitQuestion } from "@/lib/service";
import { questionSchema } from "@/lib/validation";
import { handle, ok, readJson, fail } from "@/lib/http";
import { loadRoom, requireParticipant, clientKey } from "@/lib/route-context";
import { allow, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Learner submits a question.
 *
 * The author is recorded so the same learner cannot be impersonated and so an
 * opt-in name can be shown to the instructor, but the author is never included
 * in any learner or public projection.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    const participant = await requireParticipant(req, room);

    if (!allow(clientKey(req, `question:${participant.id}`), LIMITS.question)) {
      return fail("rate_limited", "You have sent several questions already. Give it a moment.");
    }

    const { body, anonymous, sectionId, activityId } = await readJson(req, questionSchema);
    const result = await submitQuestion(room, participant.id, body, anonymous ?? true, {
      sectionId,
      activityId,
    });
    return ok(result);
  });
}
