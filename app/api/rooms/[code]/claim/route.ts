import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, hostCookieName } from "@/lib/auth";
import { loadRoom } from "@/lib/route-context";
import { tokenMatches } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-establish instructor access from a saved host link.
 *
 * The instructor may need the console on a different machine mid-class (a
 * laptop swap, a cleared browser). The token is verified here and moved
 * straight into an httpOnly cookie, then we redirect so it does not linger in
 * the address bar or in browser history.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const token = new URL(req.url).searchParams.get("t") ?? "";

  let room;
  try {
    room = await loadRoom(code);
  } catch {
    return NextResponse.redirect(new URL("/?error=unknown-room", req.url));
  }

  if (!token || !tokenMatches(token, room.host_token_hash)) {
    return NextResponse.redirect(new URL(`/?error=bad-host-link`, req.url));
  }

  const jar = await cookies();
  jar.set(hostCookieName(room.code), token, cookieOptions());
  return NextResponse.redirect(new URL(`/r/${room.code}/host`, req.url));
}
