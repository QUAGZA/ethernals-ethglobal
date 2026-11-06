import Link from "next/link";
import type { AgentSummary } from "@ethernals/shared";
import { ensAppUrl } from "@ethernals/shared";
import { shortUsdc } from "@/lib/format";
import { isMockAgent } from "@/lib/mock-agents";
import { AvatarFor, displayName } from "./agent-card";
import { ExtLink } from "./ext-link";

const USE_BUTTON =
  "inline-flex items-center gap-3 whitespace-nowrap border border-ink bg-cobalt px-5 py-[15px] text-[12px] tracking-[.08em] text-ink transition-colors duration-200 hover:bg-ink hover:text-white";

function Figure({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="border-l border-ink pl-4 max-md:border-l-0 max-md:border-t max-md:pt-3 max-md:pl-0">
      <strong className="block font-serif text-[clamp(28px,3vw,44px)] leading-none font-normal">
        {value}
        {unit && <span className="ml-1 font-mono text-[11px] opacity-60">{unit}</span>}
      </strong>
      <small className="eyebrow mt-2 block opacity-60">{label}</small>
    </div>
  );
}

/**
 * The top of every agent page: the character first, then the credibility summary
 * (score, verified votes, counted hires, price) with the ENS and Hedera links.
 */
export function AgentCredibility({
  agent,
  hederaAccountUrl,
  ensUrl,
  preview = false,
}: {
  agent: AgentSummary;
  hederaAccountUrl?: string | null;
  ensUrl?: string | null;
  preview?: boolean;
}) {
  const nick = displayName(agent);
  const specialty = isMockAgent(agent) ? agent.specialty : (agent.taskType ?? agent.kind);
  return (
    <section className="border-b border-ink px-[2.2vw] pt-[3.5vw] pb-[3vw] max-md:px-5 max-md:pt-10 max-md:pb-8">
      <div className="grid grid-cols-[minmax(180px,220px)_1fr] items-start gap-[3vw] max-md:grid-cols-1 max-md:gap-8">
        <div className="grid place-items-center bg-cobalt-pale p-6 max-md:max-w-[240px]">
          <AvatarFor agent={agent} size="100%" className="w-full" />
        </div>
        <div className="min-w-0">
          <p className="eyebrow m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Agent · {specialty}</span>
            <span className="opacity-60">by @{agent.ownerHandle}</span>
            {preview && <span className="bg-cobalt px-2 py-0.5">preview</span>}
          </p>
          <h1 className="display-heading m-0 mt-4 text-[clamp(44px,6vw,96px)] break-words">{nick}</h1>
          <p className="m-0 mt-3 text-[12px] break-all opacity-70">{agent.ensName}</p>
          <p className="m-0 mt-5 max-w-[640px] text-[14px] leading-[1.6]">{agent.description || "No description."}</p>

          <dl className="m-0 mt-8 grid grid-cols-4 gap-6 max-md:grid-cols-2 max-md:gap-5">
            <Figure label="score · of 5" value={agent.score} />
            <Figure label="verified votes" value={agent.votes} />
            <Figure label="counted hires" value={`${agent.hiresCounted}/${agent.hiresTotal}`} />
            <Figure label="price per task" value={shortUsdc(agent.price)} unit="USDC" />
          </dl>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href={`/agents/${agent.label}/use`} className={USE_BUTTON}>
              USE AGENT <span aria-hidden>→</span>
            </Link>
            {preview ? (
              <span className="text-[11px] opacity-70">ENS {agent.ensName} · Hedera {agent.hederaAccountId}</span>
            ) : (
              <>
                <ExtLink href={ensUrl || ensAppUrl(agent.ensName)}>ENS app</ExtLink>
                <ExtLink href={hederaAccountUrl}>Hedera account {agent.hederaAccountId}</ExtLink>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
