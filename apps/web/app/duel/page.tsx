import type { Metadata } from "next";
import { Suspense } from "react";
import { DuelView } from "@/components/duel-view";

export const metadata: Metadata = { title: "Duel" };

export default function DuelPage() {
  return (
    <Suspense>
      <DuelView />
    </Suspense>
  );
}
