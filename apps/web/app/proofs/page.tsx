import type { Metadata } from "next";
import { ProofsView } from "@/components/proofs-view";

export const metadata: Metadata = { title: "Proofs" };

export default function ProofsPage() {
  return <ProofsView />;
}
