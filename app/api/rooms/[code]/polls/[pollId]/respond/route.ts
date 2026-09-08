import { respondToPoll } from "@/lib/service";
import { respondSchema } from "@/lib/validation";
import { handle, ok, readJson, fail } from "@/lib/http";
import { loadRoom, requireParticipant, clientKey } from "@/lib/route-context";
import { allow, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; pollId: string }> },
) {
  return handle(async () => {
    const { code, pollId } = await ctx.params;
    const room = await loadRoom(code);
    const participant = await requireParticipant(req, room);

    if (!allow(clientKey(req, `respond:${participant.id}`), LIMITS.respond)) {
      return fail("rate_limited", "Slow down a moment.");
    }

    const { value } = await readJson(req, respondSchema);
    const result = await respondToPoll(room, pollId, participant.id, value);
    return ok(result);
  });
}
