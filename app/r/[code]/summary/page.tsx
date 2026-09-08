import { SummaryView } from "./SummaryView";
import { normalizeRoomCode } from "@/lib/room-code";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <SummaryView code={normalizeRoomCode(code)} />;
}
