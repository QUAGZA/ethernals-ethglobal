"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { shortUsdc } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { mockAgent } from "@/lib/mock-agents";
import { AvatarFor, displayName } from "./agent-card";
import { ErrorNotice } from "./error-notice";
import { MockX402Gateway } from "./mock-x402-gateway";
import { PageHeading, Panel } from "./page-heading";

const HirePanel = dynamic(() => import("./hire-panel").then((m) => m.HirePanel), {
  loading: () => <p className="eyebrow m-0 py-6 opacity-60">Loading the checkout…</p>,
});

/**
 * /agents/[label]/use: the x402 checkout. Live agents go through the real hire flow
 * (quote, USDC payment on Hedera, result, rating); mock agents get a safe preview.
 */
export function UseAgentView({ label }: { label: string }) {
  const mock = mockAgent(label);
  const loader = useCallback(() => api.agent(label), [label]);
  const detail = useLoad(loader, label && !mock ? `agent:${label}` : null);
  const agent = mock ?? detail.data;

  return (
    <>
      <PageHeading
        eyebrow="x402 checkout · pay per task in USDC on Hedera"
        title={agent ? <span className="break-words">Use {displayName(agent)}</span> : <>Use agent</>}
        aside={
          agent && (
            <div className="flex items-center gap-4">
              <AvatarFor agent={agent} size={64} />
              <div>
                <p className="m-0 text-[11px] break-all opacity-60">{agent.ensName}</p>
                <p className="m-0 mt-1 font-serif text-[24px] leading-none">
                  {shortUsdc(agent.price)} <span className="font-mono text-[10px] opacity-60">USDC / TASK</span>
                </p>
              </div>
            </div>
          )
        }
      >
        Enter the task, review the agent, network, protocol, asset and price, then authorize the x402 payment. Your buyer agent pays;
        the hire is recorded on the HireLedger whether or not it counts.{" "}
        <Link className="border-b" href={`/agents/${label}`}>
          Back to the agent →
        </Link>
      </PageHeading>

      <section className="px-[2.2vw] py-[3vw] max-md:px-5 max-md:py-8">
        {mock ? (
          <MockX402Gateway agent={mock} />
        ) : detail.error ? (
          <ErrorNotice title={detail.error.status === 404 ? "No such agent" : "Could not load this agent"} error={detail.error} onRetry={() => void detail.reload()} />
        ) : !detail.data ? (
          <p className="eyebrow m-0 opacity-60">Loading agent…</p>
        ) : (
          <div className="flex flex-col gap-[18px]">
            <Panel title="Review before you pay" bodyClassName="p-0">
              <dl className="m-0 grid grid-cols-5 divide-x divide-line max-md:grid-cols-2 max-md:divide-x-0 max-md:divide-y">
                {[
                  { label: "Agent", value: detail.data.ensName },
                  { label: "Network", value: "Hedera testnet" },
                  { label: "Protocol", value: "x402" },
                  { label: "Asset", value: "USDC" },
                  { label: "Price", value: `${shortUsdc(detail.data.price)} USDC` },
                ].map((r) => (
                  <div key={r.label} className="px-5 py-4">
                    <dt className="eyebrow opacity-60">{r.label}</dt>
                    <dd className="m-0 mt-1 text-[13px] break-all">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <HirePanel key={detail.data.key} agent={detail.data} reloadAgent={detail.reload} />
          </div>
        )}
      </section>
    </>
  );
}
