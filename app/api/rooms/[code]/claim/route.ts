import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, hostCookieName } from "@/lib/auth";
import { loadRoom } from "@/lib/route-context";
import { tokenMatches } from "@/lib/ids";
import { withRequestDatabase } from "@/lib/db";

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
  // This route does not go through handle(), so it opens its own scope.
  return withRequestDatabase(() => claim(req, ctx));
}

async function claim(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const token = new URL(req.url).searchParams.get("t") ?? "";

  // Both failure modes give the same answer. Distinguishing "no such room" from
  // "wrong token" would turn this unauthenticated endpoint into a free oracle
  // for sweeping the six-character code space.
  const refuse = () => NextResponse.redirect(new URL("/?error=bad-host-link", req.url));

  let room;
  try {
    room = await loadRoom(code);
  } catch {
    return refuse();
  }

  if (!token || !tokenMatches(token, room.host_token_hash)) return refuse();

  const jar = await cookies();
  jar.set(hostCookieName(room.code), token, cookieOptions());
  return NextResponse.redirect(new URL(`/r/${room.code}/host`, req.url));
}
