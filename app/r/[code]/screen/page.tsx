import { headers } from "next/headers";
import { PublicView } from "./PublicView";
import { normalizeRoomCode } from "@/lib/room-code";
import { qrDataUrl } from "@/lib/qr";

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

  return <PublicView code={code} joinUrl={joinUrl} qr={qr} />;
}
