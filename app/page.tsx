import { Suspense } from "react";
import { HomeScreen } from "./HomeScreen";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeScreen />
    </Suspense>
  );
}
