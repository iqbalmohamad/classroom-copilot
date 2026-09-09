import { actOnQuestion } from "@/lib/service";
import { questionActionSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instructor-only: mark answered, reopen, or hide a question from the class. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; questionId: string }> },
) {
  return handle(async () => {
    const { code, questionId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { action } = await readJson(req, questionActionSchema);
    await actOnQuestion(room, questionId, action);
    return ok({ action });
  });
}
