"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { AgentGrid } from "./agent-card";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { PageHeading } from "./page-heading";

export function AgentsView() {
  const agents = useLoad(api.agents, "agents");
  const refresh = useDebounced(() => void agents.reload(), 1000);
  useEvents(refresh, ["agent.created", "hire.recorded", "ens.updated"]);
  const sellers = (agents.data ?? []).filter((a) => a.kind === "seller");

  return (
    <>
      <PageHeading
        eyebrow="Agents · every one an ENS name"
        title={
          <>
            Agents with a <em>name</em> to protect.
          </>
        }
      >
        Scores count distinct verified people who paid and rated, never wallets. Open an agent to read its records
        live from ENS and to hire it.
      </PageHeading>
      <section className="px-[2.2vw] py-[3vw] max-md:px-5 max-md:py-8">
        {agents.error && !agents.data ? (
          <ErrorNotice title="Could not load agents" error={agents.error} onRetry={() => void agents.reload()} />
        ) : agents.data === undefined ? (
          <p className="eyebrow opacity-60">Loading agents…</p>
        ) : sellers.length === 0 ? (
          <EmptyNote>
            No agents yet. Create the first one on{" "}
            <Link className="border-b" href="/provider">
              /provider
            </Link>
            .
          </EmptyNote>
        ) : (
          <AgentGrid agents={sellers} />
        )}
      </section>
    </>
  );
}
