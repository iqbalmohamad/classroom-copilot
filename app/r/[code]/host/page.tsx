import { cookies, headers } from "next/headers";
import { HostConsole } from "./HostConsole";
import { normalizeRoomCode } from "@/lib/room-code";
import { qrDataUrl } from "@/lib/qr";
import { requestOrigin } from "@/lib/origin";
import { hostCookieName } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeRoomCode(raw);

  // One derivation for the whole app, so the QR, the join link and the API all
  // agree on where this deployment lives.
  const headerList = await headers();
  const origin = requestOrigin(new Request("https://placeholder.invalid", { headers: headerList }));

  const joinUrl = `${origin}/r/${code}`;
  const qr = await qrDataUrl(joinUrl);

  // The instructor's own credential, read from their own cookie on their own
  // request. It is handed to the console purely so the "instructor link" can be
  // composed; the browser never stores it.
  const jar = await cookies();
  const hostToken = jar.get(hostCookieName(code))?.value ?? null;

  return <HostConsole code={code} joinUrl={joinUrl} qr={qr} hostToken={hostToken} />;
}
