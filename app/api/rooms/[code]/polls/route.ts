import { createPoll } from "@/lib/service";
import { createPollSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, createPollSchema);
    const poll = await createPoll(room, input);
    return ok({ pollId: poll.id });
  });
}
