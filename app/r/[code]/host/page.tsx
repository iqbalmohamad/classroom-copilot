import { cookies, headers } from "next/headers";
import { HostConsole } from "./HostConsole";
import { normalizeRoomCode } from "@/lib/room-code";
import { qrDataUrl } from "@/lib/qr";
import { hostCookieName } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeRoomCode(raw);

  const headerList = await headers();
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = (configured || `${proto}://${host}`).replace(/\/+$/, "");

  const joinUrl = `${origin}/r/${code}`;
  const qr = await qrDataUrl(joinUrl);

  // The instructor's own credential, read from their own cookie on their own
  // request. It is handed to the console purely so the "instructor link" can be
  // composed; the browser never stores it.
  const jar = await cookies();
  const hostToken = jar.get(hostCookieName(code))?.value ?? null;

  return <HostConsole code={code} joinUrl={joinUrl} qr={qr} hostToken={hostToken} />;
}
