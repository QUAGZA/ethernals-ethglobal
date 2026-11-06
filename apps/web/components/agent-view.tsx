"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback } from "react";
import { TASK_TYPE_LABELS } from "@ethernals/shared";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { dateOf } from "@/lib/format";
import { useDebounced, useInterval, useLoad } from "@/lib/hooks";
import { mockDetail, type MockAgent } from "@/lib/mock-agents";
import { useEvents } from "@/lib/use-events";
import { AgentList } from "./agent-card";
import { AgentCredibility } from "./agent-credibility";
import { EnsPanel } from "./ens-panel";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { HireTable } from "./hire-table";
import { LedgerPanel } from "./ledger-panel";
import { PageHeading, Panel, Stat } from "./page-heading";

// The heavy panels (hiring, 0G brain) load only on agent pages, after the first paint.
const HirePanel = dynamic(() => import("./hire-panel").then((m) => m.HirePanel), {
  loading: () => <p className="eyebrow m-0 py-6 opacity-60">Loading the hire form…</p>,
});
const BrainPanel = dynamic(() => import("./brain-panel").then((m) => m.BrainPanel), {
  loading: () => <p className="eyebrow m-0 py-6 opacity-60">Loading the brain panel…</p>,
});
const AgentConfigPanel = dynamic(() => import("./agent-config-panel").then((m) => m.AgentConfigPanel), {
  loading: () => <p className="eyebrow m-0 py-6 opacity-60">Loading agent settings…</p>,
});

function SectionHead({ title, note }: { title: React.ReactNode; note: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
      <h2 className="display-heading m-0 text-[clamp(34px,4.5vw,72px)]">{title}</h2>
      <span className="eyebrow opacity-60">{note}</span>
    </div>
  );
}

/** A mock agent's page: credibility, specialty, identity and its proof-of-work profile. */
function MockAgentPage({ agent }: { agent: MockAgent & { siblingAgents: MockAgent[] } }) {
  return (
    <>
      <AgentCredibility agent={agent} preview />
      <section className="grid grid-cols-2 gap-[18px] px-[2.2vw] pt-[3vw] max-md:grid-cols-1 max-md:px-5 max-md:pt-8">
        <Panel title="Specialty and provider" right={<span className="opacity-60">preview</span>}>
          <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
            <Stat label="Specialty" value={agent.specialty} />
            <Stat label="Task type" value={agent.taskType ? TASK_TYPE_LABELS[agent.taskType] : "—"} />
            <Stat label="Provider" value={`@${agent.ownerHandle}`} />
            <Stat label="Provider key" value={agent.providerKeyShort} />
            <Stat label="Base price" value={`${agent.basePrice} USDC`} />
            <Stat label="Listed since" value={dateOf(agent.createdAt)} />
          </div>
          <p className="m-0 mt-5 border-t border-line pt-3 text-[11px] leading-[1.5] opacity-70">
            The provider key is public and groups every agent this person runs, so a badly rated agent cannot be hidden.
          </p>
        </Panel>
        <Panel title="ENS and Hedera identity">
          <dl className="m-0 divide-y divide-line">
            <div className="grid grid-cols-[minmax(120px,38%)_1fr] gap-4 py-2.5">
              <dt>ENS name</dt>
              <dd className="m-0 break-all">{agent.ensName}</dd>
            </div>
            <div className="grid grid-cols-[minmax(120px,38%)_1fr] gap-4 py-2.5">
              <dt>Hedera account</dt>
              <dd className="m-0">{agent.hederaAccountId}</dd>
            </div>
            <div className="grid grid-cols-[minmax(120px,38%)_1fr] gap-4 py-2.5">
              <dt>EVM address</dt>
              <dd className="m-0 text-[11px] break-all">{agent.evmAddress}</dd>
            </div>
            {agent.proof.ensRecords.map((r) => (
              <div key={r.key} className="grid grid-cols-[minmax(120px,38%)_1fr] gap-4 py-2.5">
                <dt>
                  <code className="text-[10px] opacity-60">{r.key}</code>
                </dt>
                <dd className="m-0 font-serif text-[22px] leading-none">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </section>

      <section className="px-[2.2vw] pt-[18px] max-md:px-5">
        <Panel title="Proof-of-work profile" bodyClassName="p-0">
          <div className="grid grid-cols-4 divide-x divide-line max-md:grid-cols-2 max-md:divide-x-0 max-md:divide-y">
            {[
              { label: "Tasks passed", value: agent.proof.tasksPassed },
              { label: "Tasks failed", value: agent.proof.tasksFailed },
              { label: "Inference receipts", value: agent.proof.inferenceReceipts },
              { label: "Last hire", value: dateOf(agent.proof.lastHireAt) },
            ].map((item) => (
              <div key={item.label} className="px-5 py-5">
                <strong className="block font-serif text-[32px] leading-none font-normal">{item.value}</strong>
                <small className="eyebrow mt-2 block opacity-60">{item.label}</small>
              </div>
            ))}
          </div>
          <p className="m-0 border-t border-line px-5 py-3 text-[11px] leading-[1.5] opacity-70">
            Live agents build this trail automatically: ENS records on Sepolia, the HireLedger on Hedera, verified work in the
            sandbox, ratings from distinct people, and a receipt for every inference.
          </p>
        </Panel>
      </section>

      <section className="px-[2.2vw] pt-[4vw] pb-[6vw] max-md:px-5 max-md:py-10">
        <SectionHead title={<>Other agents by @{agent.ownerHandle}</>} note="a provider can't hide a badly rated agent" />
        {agent.siblingAgents.length === 0 ? (
          <EmptyNote>This provider has no other agents.</EmptyNote>
        ) : (
          <AgentList agents={agent.siblingAgents} showOwner={false} />
        )}
      </section>
    </>
  );
}

export function AgentView({ label }: { label: string }) {
  const mock = mockDetail(label);
  const loader = useCallback(() => api.agent(label), [label]);
  const detail = useLoad(loader, label && !mock ? `agent:${label}` : null);
  const agent = detail.data;
  // Only the person who created a seller agent sees its settings.
  const { me } = useApp();
  const isOwner = Boolean(agent && me?.person && me.person.handle === agent.ownerHandle && agent.kind === "seller");

  const refresh = useDebounced(() => void detail.reload(), 600);
  useEvents(
    (message) => {
      if (agent && message.data.agentEnsName === agent.ensName) refresh();
    },
    ["hire.delivered", "hire.recorded", "hire.payment_not_verified", "ens.updated", "subhire.blocked", "task.settled"],
  );
  useInterval(() => void detail.reload(), mock ? null : 20_000);

  if (mock) return <MockAgentPage agent={{ ...mock, siblingAgents: mock.siblingAgents as MockAgent[] }} />;

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
      <AgentCredibility agent={agent} ensUrl={agent.ensAppUrl} hederaAccountUrl={agent.hederaAccountUrl} />

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
          <AgentConfigPanel label={agent.label} taskType={agent.taskType} />
        </section>
      )}

      <section className="px-[2.2vw] pt-[18px] max-md:px-5" id="hire">
        <HirePanel key={agent.key} agent={agent} reloadAgent={detail.reload} />
      </section>

      <section className="px-[2.2vw] pt-[4vw] max-md:px-5 max-md:pt-10">
        <SectionHead title={<>Hire history</>} note="every hire, counted or not" />
        {agent.hires.length === 0 ? (
          <EmptyNote>No hires yet. Be the first verified person to hire {agent.ensName}.</EmptyNote>
        ) : (
          <HireTable hires={agent.hires} />
        )}
      </section>

      <section className="px-[2.2vw] pt-[4vw] pb-[6vw] max-md:px-5 max-md:py-10">
        <SectionHead title={<>Other agents by @{agent.ownerHandle}</>} note="a provider can't hide a badly rated agent" />
        {siblings.length === 0 ? <EmptyNote>This provider has no other agents.</EmptyNote> : <AgentList agents={siblings} showOwner={false} />}
      </section>
    </>
  );
}
