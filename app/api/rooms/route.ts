import { cookies } from "next/headers";
import { createRoom } from "@/lib/service";
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

    const { title } = await readJson(req, createRoomSchema);
    const { room, hostToken } = await createRoom(title);

    const jar = await cookies();
    jar.set(hostCookieName(room.code), hostToken, cookieOptions());

    return ok({
      code: room.code,
      title: room.title,
      hostToken,
      joinUrl: joinUrl(requestOrigin(req), room.code),
    });
  });
}
