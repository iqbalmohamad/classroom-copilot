import { cookies } from "next/headers";
import { createRoom } from "@/lib/service";
import { applyPlanToRoom, loadPlan } from "@/lib/plans";
import { createRoomSchema } from "@/lib/validation";
import { handle, ok, readJson, fail } from "@/lib/http";
import { cookieOptions, hostCookieName } from "@/lib/auth";
import { allow, LIMITS } from "@/lib/rate-limit";
import { clientKey } from "@/lib/route-context";
import { requestOrigin } from "@/lib/origin";
import { joinUrl } from "@/lib/projections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a class session.
 *
 * The host token is returned once, in the response body, so the console can
 * mirror it into localStorage as a recovery copy. It is also set as an httpOnly
 * cookie, which is what normal requests use.
 */
export async function POST(req: Request) {
  return handle(async () => {
    if (!allow(clientKey(req, "create"), LIMITS.createRoom)) {
      return fail("rate_limited", "Too many rooms created. Wait a moment and try again.");
    }

    const input = await readJson(req, createRoomSchema);

    // A plan is read before the room exists, so a bad token costs nothing and
    // leaves no half-built session behind.
    const plan =
      input.planId && input.planToken
        ? await loadPlan(input.planId, input.planToken)
        : null;

    const { room, hostToken } = await createRoom(input.title ?? plan?.title);
    // Fresh room, fresh code, fresh host token, and only the instructor's own
    // preparation copied in: no learner, submission, pulse, vote or pick from
    // the session the plan came from can reach this one.
    if (plan) await applyPlanToRoom(room, plan.payload);

    const jar = await cookies();
    jar.set(hostCookieName(room.code), hostToken, cookieOptions());

    return ok({
      code: room.code,
      title: room.title,
      hostToken,
      joinUrl: joinUrl(requestOrigin(req), room.code),
      fromPlan: plan ? { id: plan.id, title: plan.title } : null,
    });
  });
}
