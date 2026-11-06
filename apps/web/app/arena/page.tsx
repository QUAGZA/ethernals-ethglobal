import type { Metadata } from "next";
import { ArenaView } from "@/components/arena-view";

export const metadata: Metadata = { title: "Arena" };

export default function ArenaPage() {
  return <ArenaView />;
}
