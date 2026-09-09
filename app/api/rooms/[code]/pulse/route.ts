import { setPulse, startPulseRound } from "@/lib/service";
import { pulseResponseSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost, requireParticipant } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Learner sets their own pulse for the round that is collecting.
 *
 * `roundId` is the round their phone believed was open. Sending it lets a tap
 * that was already in flight when the instructor moved on be refused instead of
 * counted against a question the class has not been asked yet.
 *
 * `sectionId` and `pulseEpoch` describe the screen for the tap that carries no
 * round at all: the first tap of a quick start. The epoch is the authoritative
 * one — it distinguishes two visits to the same section and sees an explicit
 * round start — while the section check covers clients that predate the epoch.
 * Without them, a tap aimed at section A that lands after the class moved on
 * would silently open a round wherever the class is now and count an old
 * opinion against it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    const participant = await requireParticipant(req, room);
    const { pulse, roundId, sectionId, pulseEpoch } = await readJson(req, pulseResponseSchema);
    const result = await setPulse(
      room,
      participant.id,
      pulse,
      roundId ?? null,
      sectionId,
      pulseEpoch,
    );
    return ok({ pulse, roundId: result.roundId });
  });
}

/**
 * Instructor moves the pulse on to the next topic.
 *
 * Kept on DELETE because that is the quick action the console has always had,
 * but it no longer erases anything: the round that was collecting is closed and
 * stays readable, and a fresh one opens.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const round = await startPulseRound(room);
    return ok({ cleared: true, round });
  });
}
