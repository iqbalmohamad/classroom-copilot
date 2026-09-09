import { setPublicMode } from "@/lib/service";
import { publicModeSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instructor chooses what the shared screen shows. The public view never sets this. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { mode } = await readJson(req, publicModeSchema);
    await setPublicMode(room, mode);
    return ok({ mode });
  });
}
