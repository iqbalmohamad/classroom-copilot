import { createActivity } from "@/lib/workflow";
import { findPlanActivity, loadPlan } from "@/lib/plans";
import { createActivitySchema } from "@/lib/validation";
import { ApiError, handle, ok, readJson } from "@/lib/http";
import { loadRoom, requireHost } from "@/lib/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Instructor creates an activity, either typed here or lifted from one saved
 * plan. Reusing a single prepared exercise is deliberately as cheap as writing
 * a new one: nobody wants to duplicate a whole session plan to ask one question
 * again.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);
    await requireHost(req, room);
    const input = await readJson(req, createActivitySchema);

    if (input.fromPlan) {
      const plan = await loadPlan(input.fromPlan.planId, input.fromPlan.token);
      const prepared = findPlanActivity(plan.payload, input.fromPlan.key);
      if (!prepared) throw new ApiError("not_found", "That exercise is not in the plan.");
      return ok(
        await createActivity(
          room,
          {
            ...input,
            durationSeconds: input.durationSeconds ?? prepared.durationSeconds,
          },
          {
            title: prepared.title,
            fields: prepared.fields,
            instructions: prepared.instructions,
            referenceAnswer: prepared.referenceAnswer,
          },
        ),
      );
    }

    return ok(await createActivity(room, input));
  });
}
