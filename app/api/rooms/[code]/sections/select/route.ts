import { selectSection } from "@/lib/workflow";
import { selectSectionSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Go to a section, or on to the next one.
 *
 * Navigation only: this opens nothing, closes nothing and clears nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { sectionId } = await readJson(req, selectSectionSchema);
    return ok(await selectSection(room, sectionId));
  });
}
