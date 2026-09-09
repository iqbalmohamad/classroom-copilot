import { createSection } from "@/lib/workflow";
import { createSectionSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instructor adds a section, before class or in the middle of it. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, createSectionSchema);
    return ok(await createSection(room, { title: input.title, afterId: input.afterId }));
  });
}
