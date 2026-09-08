import { toggleQuestionVote } from "@/lib/service";
import { handle, ok, fail } from "@/lib/http";
import { loadRoom, requireParticipant, clientKey } from "@/lib/route-context";
import { allow, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Toggle this learner's single upvote.
 *
 * Uniqueness is a primary key in the database, so however many times the button
 * is tapped the learner contributes at most one vote.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; questionId: string }> },
) {
  return handle(async () => {
    const { code, questionId } = await ctx.params;
    const room = await loadRoom(code);
    const participant = await requireParticipant(req, room);

    if (!allow(clientKey(req, `vote:${participant.id}`), LIMITS.vote)) {
      return fail("rate_limited", "Slow down a moment.");
    }

    const result = await toggleQuestionVote(room, questionId, participant.id);
    return ok(result);
  });
}
