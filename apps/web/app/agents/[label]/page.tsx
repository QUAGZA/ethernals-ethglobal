"use client";

import { useParams } from "next/navigation";
import { AgentView } from "@/components/agent-view";

// Client-side fetching only: no generateStaticParams, the server is not needed at build time.
export default function AgentPage() {
  const params = useParams<{ label: string }>();
  const raw = typeof params?.label === "string" ? params.label : "";
  let label = raw;
  try {
    label = decodeURIComponent(raw);
  } catch {
    /* keep the raw value */
  }
  return <AgentView key={label} label={label} />;
}
