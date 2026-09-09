import { cookies } from "next/headers";
import { joinRoom } from "@/lib/service";
import { joinRoomSchema } from "@/lib/validation";
import { handle, ok, readJson, fail } from "@/lib/http";
import { cookieOptions, participantCookieName } from "@/lib/auth";
import { loadRoom, clientKey } from "@/lib/route-context";
import { allow, LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Join, or re-join. A browser that already holds a participant token for this
 * room reuses its existing identity, which is what makes refreshing harmless.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const room = await loadRoom(code);

    if (!allow(clientKey(req, `join:${room.code}`), LIMITS.join)) {
      return fail("rate_limited", "Too many join attempts. Wait a moment and try again.");
    }

    const { displayName } = await readJson(req, joinRoomSchema);

    const jar = await cookies();
    const existing =
      req.headers.get("x-cc-learner-token") ??
      jar.get(participantCookieName(room.code))?.value ??
      null;

    const result = await joinRoom(room, displayName, existing);
    jar.set(participantCookieName(room.code), result.token, cookieOptions());

    return ok({
      displayName: result.displayName,
      rejoined: result.rejoined,
      learnerToken: result.token,
    });
  });
}
