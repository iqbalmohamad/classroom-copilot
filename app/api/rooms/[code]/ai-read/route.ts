import { AiUnavailable, classRead } from "@/lib/ai";
import { isAiEnabled } from "@/lib/env";
import { handle, ok, fail } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";
import { instructorSnapshot } from "@/lib/projections";
import { requestOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Optional AI Class Read. Instructor only, aggregates only, read only.
 *
 * Every failure path returns a plain message the console can show without
 * disturbing anything else — the classroom does not depend on this route
 * existing, and the panel is not even rendered unless a key is configured.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);

    if (!isAiEnabled()) {
      return fail("unavailable", "Class read is not enabled for this deployment.");
    }

    const snapshot = await instructorSnapshot(room, requestOrigin(req));

    try {
      const reading = await classRead(snapshot);
      return ok({ reading });
    } catch (error) {
      if (error instanceof AiUnavailable) {
        return fail("unavailable", "Class read is unavailable right now. Carry on without it.");
      }
      throw error;
    }
  });
}
