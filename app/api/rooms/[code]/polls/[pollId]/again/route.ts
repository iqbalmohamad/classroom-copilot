import { askAgain } from "@/lib/service";
import { handle, ok } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Put an earlier question to the class again, as a fresh round. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; pollId: string }> },
) {
  return handle(async () => {
    const { code, pollId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const poll = await askAgain(room, pollId);
    return ok({ pollId: poll.id });
  });
}
