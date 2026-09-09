import { deleteSection, renameSection } from "@/lib/workflow";
import { renameSectionSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string; sectionId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { code, sectionId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const { title } = await readJson(req, renameSectionSchema);
    await renameSection(room, sectionId, title);
    return ok({ renamed: true });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { code, sectionId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    await deleteSection(room, sectionId);
    return ok({ deleted: true });
  });
}
