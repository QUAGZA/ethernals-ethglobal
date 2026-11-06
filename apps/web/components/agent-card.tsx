import Link from "next/link";
import { memo } from "react";
import type { AgentSummary } from "@ethernals/shared";
import { labelOf, shortUsdc } from "@/lib/format";
import { isMockAgent } from "@/lib/mock-agents";
import { AgentAvatar } from "./agent-avatar";

/** "Signal Sprout" for a mock agent, otherwise the ENS label with hyphens as spaces. */
export function displayName(agent: AgentSummary): string {
  if (isMockAgent(agent)) return agent.nickname;
  return labelOf(agent.ensName).replace(/-/g, " ");
}

export function AvatarFor({ agent, size, className = "" }: { agent: AgentSummary; size: number | string; className?: string }) {
  const mock = isMockAgent(agent) ? agent.character : undefined;
  return <AgentAvatar seed={agent.ensName} shape={mock?.shape} color={mock?.color} size={size} className={className} />;
}

const BUTTON = "inline-flex items-center justify-center whitespace-nowrap border border-ink px-4 py-2.5 text-[11px] tracking-[.08em] transition-colors duration-200";

/**
 * One agent per line: character, name and owner, description, score, price, verified jobs,
 * then OPEN and USE AGENT. On narrow screens the secondary details collapse.
 */
export const AgentRow = memo(function AgentRow({ agent, showOwner = true }: { agent: AgentSummary; showOwner?: boolean }) {
  const href = `/agents/${agent.label}`;
  return (
    <article className="grid grid-cols-[72px_minmax(0,2fr)_minmax(0,2.2fr)_88px_104px_96px_auto] items-center gap-5 border-b border-line py-4 transition-colors duration-200 hover:bg-cobalt-pale/60 max-md:grid-cols-[56px_minmax(0,1fr)_auto] max-md:gap-3 max-md:py-4">
      <Link href={href} className="block" aria-hidden tabIndex={-1}>
        <AvatarFor agent={agent} size="100%" className="size-[72px] max-md:size-[56px]" />
      </Link>

      <div className="min-w-0">
        <h3 className="m-0 truncate text-[clamp(20px,2vw,28px)] leading-[1.05]">
          <Link href={href} className="transition-opacity hover:opacity-60">
            {displayName(agent)}
          </Link>
        </h3>
        <p className="m-0 mt-1 truncate text-[10px] tracking-[.08em] uppercase opacity-60">
          {agent.ensName}
          {showOwner && ` · by @${agent.ownerHandle}`}
        </p>
        <p className="m-0 mt-2 hidden leading-[1.4] max-md:block">
          <span className="font-medium">{agent.score}</span> · {shortUsdc(agent.price)} USDC · {agent.hiresCounted} verified
        </p>
      </div>

      <p className="m-0 line-clamp-2 leading-[1.5] opacity-80 max-md:hidden">{agent.description || agent.taskType || "—"}</p>

      <div className="max-md:hidden">
        <strong className="block font-serif text-[26px] leading-none font-normal">{agent.score}</strong>
        <small className="eyebrow block opacity-60">score</small>
      </div>
      <div className="max-md:hidden">
        <strong className="block text-[14px] leading-none">
          {shortUsdc(agent.price)} <span className="text-[10px] opacity-60">USDC</span>
        </strong>
        <small className="eyebrow block pt-1 opacity-60">per task</small>
      </div>
      <div className="max-md:hidden">
        <strong className="block text-[14px] leading-none">{agent.hiresCounted}</strong>
        <small className="eyebrow block pt-1 opacity-60">verified jobs</small>
      </div>

      <div className="flex gap-2 max-md:flex-col max-md:gap-1.5">
        <Link href={href} className={`${BUTTON} hover:bg-ink hover:text-white max-md:hidden`}>
          OPEN
        </Link>
        <Link href={`${href}/use`} className={`${BUTTON} bg-cobalt hover:bg-ink hover:text-white max-md:px-3 max-md:py-2`}>
          USE AGENT →
        </Link>
      </div>
    </article>
  );
});

export function AgentList({ agents, showOwner = true }: { agents: AgentSummary[]; showOwner?: boolean }) {
  return (
    <div className="border-t border-ink">
      {agents.map((a) => (
        <AgentRow key={a.key} agent={a} showOwner={showOwner} />
      ))}
    </div>
  );
}
