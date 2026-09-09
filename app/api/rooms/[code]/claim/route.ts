import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, hostCookieName } from "@/lib/auth";
import { loadRoom } from "@/lib/route-context";
import { requestOrigin } from "@/lib/origin";
import { tokenMatches } from "@/lib/ids";
import { withRequestDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-establish instructor access from a saved host link.
 *
 * The instructor may need the console on a different machine mid-class (a
 * laptop swap, a cleared browser), or may be reopening a class from weeks ago
 * whose session cookie expired long since. The token is verified here and moved
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
  // Redirect targets are built from the public origin, not from `req.url`.
  //
  // Next reports a route handler's `request.url` as the server's own address,
  // which is not the host the instructor typed: behind a proxy — or simply on
  // 127.0.0.1 versus localhost — redirecting to it moves the browser to a
  // different origin, and the cookie this route has just set is left behind on
  // the old one. The instructor lands back on "Instructor access needed" with a
  // link that was perfectly valid.
  const origin = requestOrigin(req);
  const refuse = () => NextResponse.redirect(new URL("/?error=bad-host-link", origin));

  let room;
  try {
    room = await loadRoom(code);
  } catch {
    return refuse();
  }

  if (!token || !tokenMatches(token, room.host_token_hash)) return refuse();

  const jar = await cookies();
  jar.set(hostCookieName(room.code), token, cookieOptions());

  // Where to land. An allow-list of two, not a caller-supplied path: this
  // endpoint is unauthenticated until the token checks out, and an open
  // redirect on it would be a phishing primitive attached to a real class code.
  const to = new URL(req.url).searchParams.get("to") === "summary" ? "summary" : "host";
  return NextResponse.redirect(new URL(`/r/${room.code}/${to}`, origin));
}
