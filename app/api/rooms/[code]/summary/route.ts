import { buildSummary } from "@/lib/summary";
import { csvFilename, summaryCsv } from "@/lib/export";
import { handle, ok } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Instructor-only.
 *
 * The summary carries roster-derived data, named submissions and private
 * feedback, so it never leaves this route and this route always requires the
 * host token. `?format=csv` returns the same data as a download; nothing is
 * added to the export that the JSON does not already contain.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const summary = await buildSummary(room);

    if (new URL(req.url).searchParams.get("format") === "csv") {
      return new Response(summaryCsv(summary), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${csvFilename(summary)}"`,
          "cache-control": "no-store",
        },
      });
    }

    return ok({ summary });
  });
}
