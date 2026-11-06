"use client";

import { useParams } from "next/navigation";
import { UseAgentView } from "@/components/use-agent-view";

export default function UseAgentPage() {
  const params = useParams<{ label: string }>();
  const raw = typeof params?.label === "string" ? params.label : "";
  let label = raw;
  try {
    label = decodeURIComponent(raw);
  } catch {
    /* keep the raw value */
  }
  return <UseAgentView key={label} label={label} />;
}
