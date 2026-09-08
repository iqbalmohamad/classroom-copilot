import "server-only";

/**
 * The public origin used to build join URLs and QR codes.
 *
 * NEXT_PUBLIC_APP_URL wins when set (deployments behind a custom domain), and
 * otherwise we trust the forwarded host headers that the platform sets. Falls
 * back to the local dev origin.
 */
export function requestOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
