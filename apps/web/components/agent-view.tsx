"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ensAppUrl } from "@ethernals/shared";
import { api } from "@/lib/api";
import { useDebounced, useInterval, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { AgentGrid } from "./agent-card";
import { useApp } from "@/lib/app-context";
import { AgentConfigPanel } from "./agent-config-panel";
import { BrainPanel } from "./brain-panel";
import { EnsPanel } from "./ens-panel";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { HirePanel } from "./hire-panel";
import { HireTable } from "./hire-table";
import { LedgerPanel } from "./ledger-panel";
import { PageHeading } from "./page-heading";

export function AgentView({ label }: { label: string }) {
  const loader = useCallback(() => api.agent(label), [label]);
  const detail = useLoad(loader, label ? `agent:${label}` : null);
  const agent = detail.data;
  const { me } = useApp();
  const isOwner = Boolean(agent && me?.person && me.person.handle === agent.ownerHandle && agent.kind === "seller");

  const refresh = useDebounced(() => void detail.reload(), 600);
  useEvents(
    (message) => {
      if (agent && message.data.agentEnsName === agent.ensName) refresh();
    },
    ["hire.delivered", "hire.recorded", "hire.payment_not_verified", "ens.updated", "subhire.blocked", "task.settled"],
  );
  useInterval(() => void detail.reload(), 20_000);

  if (!agent) {
    return (
      <>
        <PageHeading eyebrow="Agent" title={<span className="break-all">{label || "…"}</span>} />
        <section className="px-[2.2vw] py-[3vw] max-md:px-5">
          {detail.error ? (
            <div className="flex flex-col items-start gap-4">
              <ErrorNotice
                title={detail.error.status === 404 ? "No such agent" : "Could not load this agent"}
                error={detail.error}
                onRetry={() => void detail.reload()}
              />
              <Link className="border-b" href="/agents">
                ← All agents
              </Link>
            </div>
          ) : (
            <p className="eyebrow opacity-60">Loading agent…</p>
          )}
        </section>
      </>
    );
  }

  const siblings = agent.siblingAgents.filter((a) => a.key !== agent.key);

  return (
    <>
      <PageHeading
        eyebrow={`Agent · ${agent.taskType ?? agent.kind} · by @${agent.ownerHandle}`}
        title={<span className="break-all">{agent.ensName}</span>}
        aside={
          <div className="flex flex-col items-end gap-2 text-right max-md:items-start max-md:text-left">
            <ExtLink href={agent.ensAppUrl || ensAppUrl(agent.ensName)}>ENS app</ExtLink>
            {agent.hederaAccountUrl && <ExtLink href={agent.hederaAccountUrl}>Hedera account {agent.hederaAccountId}</ExtLink>}
          </div>
        }
      >
        <p className="m-0">{agent.description || "No description."}</p>
        <p className="m-0 mt-2 text-[12px] opacity-70">
          Owner @{agent.ownerHandle} · provider key {agent.providerKeyShort}
          {agent.endpoint ? ` · x402 endpoint ${agent.endpoint}` : ""}
        </p>
      </PageHeading>

      <section className="grid grid-cols-2 gap-[18px] px-[2.2vw] pt-[3vw] max-md:grid-cols-1 max-md:px-5 max-md:pt-8">
        <EnsPanel key={agent.ensName} ensName={agent.ensName} ledgerScore={agent.score} />
        <LedgerPanel agent={agent} />
      </section>

      {agent.remote ? (
        <section className="px-[2.2vw] pt-[18px] max-md:px-5">
          <p className="m-0 border px-5 py-4 text-[12px] leading-[1.6]">
            This agent was found on-chain (ENS + HireLedger) and runs on another server. Its endpoint is currently{" "}
            <b>{agent.endpointStatus ?? "unknown"}</b>
            {agent.endpointStatus === "online" ? "." : ", so a hire may fail."} Its score, price and votes are read from the ledger.
          </p>
        </section>
      ) : (
        <section className="px-[2.2vw] pt-[18px] max-md:px-5">
          <BrainPanel agent={agent} />
        </section>
      )}

      {isOwner && (
        <section className="px-[2.2vw] pt-[18px] max-md:px-5">
          <AgentConfigPanel label={agent.label} />
        </section>
      )}

      <section className="px-[2.2vw] pt-[18px] max-md:px-5">
        <HirePanel key={agent.key} agent={agent} reloadAgent={detail.reload} />
      </section>

      <section className="px-[2.2vw] pt-[4vw] max-md:px-5 max-md:pt-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="display-heading m-0 text-[clamp(40px,4.5vw,72px)]">
            Hire <em>history</em>
          </h2>
          <span className="eyebrow opacity-60">every hire, counted or not</span>
        </div>
        {agent.hires.length === 0 ? (
          <EmptyNote>No hires yet. Be the first verified person to hire {agent.ensName}.</EmptyNote>
        ) : (
          <HireTable hires={agent.hires} />
        )}
      </section>

      <section className="px-[2.2vw] pt-[4vw] pb-[6vw] max-md:px-5 max-md:py-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="display-heading m-0 text-[clamp(40px,4.5vw,72px)]">
            Other agents by <em>@{agent.ownerHandle}</em>
          </h2>
          <span className="eyebrow opacity-60">a provider can&apos;t hide a badly rated agent</span>
        </div>
        {siblings.length === 0 ? <EmptyNote>This provider has no other agents.</EmptyNote> : <AgentGrid agents={siblings} />}
      </section>
    </>
  );
}
