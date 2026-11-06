"use client";

import { useMemo } from "react";
import type { AgentSummary } from "@ethernals/shared";
import { api } from "./api";
import { useDebounced, useLoad } from "./hooks";
import { MOCK_PUBLIC } from "./mock-agents";
import { useEvents } from "./use-events";

export interface AgentDirectory {
  /** Seller agents to show; undefined only while the first load is in flight. */
  agents: AgentSummary[] | undefined;
  /** True when the list is the mock preview (server unreachable or no agents yet). */
  preview: boolean;
  reload: () => void;
}

/**
 * The public directory of seller agents, kept fresh from the event stream.
 * If the server cannot be reached, or has no agents yet, the mock preview takes its place
 * so the marketplace is never empty and never shows a server error.
 */
export function useAgentDirectory(): AgentDirectory {
  const loaded = useLoad(api.agents, "agents");
  const refresh = useDebounced(() => void loaded.reload(), 1000);
  useEvents(refresh, ["agent.created", "hire.recorded", "ens.updated"]);

  return useMemo(() => {
    const live = loaded.data?.filter((a) => a.kind === "seller");
    if (live && live.length > 0) return { agents: live, preview: false, reload: refresh };
    if (loaded.error || (live && live.length === 0)) return { agents: MOCK_PUBLIC, preview: true, reload: refresh };
    return { agents: undefined, preview: false, reload: refresh };
  }, [loaded.data, loaded.error, refresh]);
}
