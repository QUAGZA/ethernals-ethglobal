import type { Metadata } from "next";
import { ProviderView } from "@/components/provider-view";

export const metadata: Metadata = { title: "Provide" };

export default function ProviderPage() {
  return <ProviderView />;
}
