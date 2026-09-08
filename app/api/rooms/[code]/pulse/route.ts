import { clearPulses, setPulse } from "@/lib/service";
import { pulseSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost, requireParticipant } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Learner sets their own pulse. One value per learner; taps replace, never add. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    const participant = await requireParticipant(req, room);
    const { pulse } = await readJson(req, pulseSchema);
    await setPulse(room, participant.id, pulse);
    return ok({ pulse });
  });
}

/** Instructor clears the class pulse before moving to a new topic. */
export async function DELETE(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    await clearPulses(room);
    return ok({ cleared: true });
  });
}
