import { createMaterial } from "@/lib/workflow";
import { createMaterialSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instructor adds a link: a dataset, an install guide, the LMS submission page. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, createMaterialSchema);
    return ok(await createMaterial(room, input));
  });
}
