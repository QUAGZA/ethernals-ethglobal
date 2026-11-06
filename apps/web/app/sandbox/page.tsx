import type { Metadata } from "next";
import { SandboxView } from "@/components/sandbox-view";

export const metadata: Metadata = { title: "Sandbox" };

export default function SandboxPage() {
  return <SandboxView />;
}
