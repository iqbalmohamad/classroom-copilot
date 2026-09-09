import { headers } from "next/headers";
import { PublicView } from "./PublicView";
import { normalizeRoomCode } from "@/lib/room-code";
import { qrDataUrl } from "@/lib/qr";
import { requestOrigin } from "@/lib/origin";

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

  return <PublicView code={code} joinUrl={joinUrl} qr={qr} />;
}
