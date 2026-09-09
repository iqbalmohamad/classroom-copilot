import { loadPlan } from "@/lib/plans";
import { planTokenSchema } from "@/lib/validation";
import { handle, ok, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read a saved plan.
 *
 * A read behind POST on purpose: the plan token is the only thing that
 * authorises it, and a token in a query string ends up in browser history,
 * referrers and access logs. The body keeps it out of all three.
 */
export async function POST(req: Request, ctx: { params: Promise<{ planId: string }> }) {
  return handle(async () => {
    const { planId } = await ctx.params;
    const { token } = await readJson(req, planTokenSchema);
    const plan = await loadPlan(planId, token);
    return ok({ plan });
  });
}
