import { LearnerView } from "./LearnerView";
import { normalizeRoomCode } from "@/lib/room-code";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <LearnerView code={normalizeRoomCode(code)} />;
}
