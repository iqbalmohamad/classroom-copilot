import { deleteMaterial, updateMaterial } from "@/lib/workflow";
import { updateMaterialSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string; materialId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { code, materialId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, updateMaterialSchema);
    await updateMaterial(room, materialId, input);
    return ok({ updated: true });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { code, materialId } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    await deleteMaterial(room, materialId);
    return ok({ deleted: true });
  });
}
