"use client";

import type { AgentDetail } from "@ethernals/shared";
import { hashscanContractUrl } from "@ethernals/shared";
import { useApp } from "@/lib/app-context";
import { shortUsdc } from "@/lib/format";
import { ExtLink } from "./ext-link";
import { FlashValue } from "./flash-value";

/** Ledger stats for an agent, as reported by our API from the HireLedger contract on Hedera. */
export function LedgerPanel({ agent }: { agent: AgentDetail }) {
  const { config } = useApp();
  const rows: { label: string; value: string; big?: boolean }[] = [
    { label: "Score", value: agent.score, big: true },
    { label: "Price (USDC)", value: agent.price, big: true },
    { label: "Votes (distinct people)", value: String(agent.votes) },
    { label: "Counted hires", value: String(agent.hiresCounted) },
    { label: "All hires", value: String(agent.hiresTotal) },
    { label: "Base price", value: agent.basePrice },
  ];
  return (
    <section className="flex flex-col border">
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3.5">
        <span className="eyebrow font-medium">HireLedger · Hedera testnet</span>
        <span className="flex gap-4">
          <ExtLink href={config?.ledgerAddress ? hashscanContractUrl(config.ledgerAddress) : null} className="text-[11px]">
            Contract
          </ExtLink>
          <ExtLink href={agent.hederaAccountUrl} className="text-[11px]">
            Agent account
          </ExtLink>
        </span>
      </header>
      <dl className="m-0 divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(130px,38%)_1fr] items-baseline gap-4 px-5 py-2.5">
            <dt>{row.label}</dt>
            <dd className={`m-0 ${row.big ? "font-serif text-[28px] leading-none" : ""}`}>
              <FlashValue value={row.value} tween={false} />
              {row.label.startsWith("Price") && <span className="ml-2 font-mono text-[11px] opacity-60">≈ {shortUsdc(agent.price)}</span>}
            </dd>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(130px,38%)_1fr] items-baseline gap-4 px-5 py-2.5">
          <dt>Hedera account</dt>
          <dd className="m-0 break-all">{agent.hederaAccountId}</dd>
        </div>
      </dl>
      <p className="m-0 mt-auto border-t px-5 py-3 text-[11px] leading-[1.5] opacity-70">
        From our API, which reads the contract. The counting rule (same person, one vote, score, price) runs in the
        contract, so anyone can audit it on HashScan.
      </p>
    </section>
  );
}
