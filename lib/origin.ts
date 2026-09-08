import "server-only";
import { appOrigin } from "./env";

/**
 * The public origin used to build join URLs and QR codes.
 *
 * APP_ORIGIN wins when set, which is what a deployment should do. Otherwise we
 * fall back to the request's own headers.
 */
export function requestOrigin(req: Request): string {
  const configured = appOrigin();
  if (configured) return configured;

  // `host` is set by the platform from the request line; `x-forwarded-host` is
  // whatever the client sent unless a proxy overwrites it. Preferring the
  // former stops a request with a spoofed forwarded host from producing join
  // links and QR codes that point somewhere else. Set NEXT_PUBLIC_APP_URL in
  // production and none of this matters.
  const host =
    req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
