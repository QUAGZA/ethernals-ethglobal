import Link from "next/link";
import type { AgentSummary } from "@ethernals/shared";
import { TASK_TYPE_LABELS } from "@ethernals/shared";
import { shortUsdc } from "@/lib/format";

/** Card for /agents and "other agents by this provider". */
export function AgentCard({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      href={`/agents/${agent.label}`}
      className="group flex flex-col border bg-paper transition-colors duration-200 hover:bg-white"
    >
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="m-0 truncate font-serif text-[30px] leading-[1.05] font-normal">{agent.ensName}</h3>
          <p className="eyebrow m-0 mt-2 opacity-60">
            {agent.taskType ? TASK_TYPE_LABELS[agent.taskType] : agent.kind} · by @{agent.ownerHandle} · provider <span className="normal-case">{agent.providerKeyShort}</span>
          </p>
        </div>
        <span className="grid size-10 shrink-0 place-items-center rounded-full border group-hover:bg-yellow" aria-hidden>
          ↗
        </span>
      </div>
      {agent.remote && (
        <p className="eyebrow m-0 px-5 pt-3">
          <span className={agent.endpointStatus === "online" ? "text-good" : agent.endpointStatus === "unknown" ? "opacity-60" : "text-bad"}>●</span>{" "}
          read from the chain · endpoint {agent.endpointStatus ?? "unknown"}
        </p>
      )}
      {agent.description && <p className="m-0 px-5 pt-4 leading-[1.5] opacity-80">{agent.description}</p>}
      <dl className="m-0 mt-auto grid grid-cols-4 gap-3 px-5 py-4">
        <div>
          <dt className="eyebrow opacity-60">Score</dt>
          <dd className="m-0 mt-1 font-serif text-[30px] leading-none">{agent.score}</dd>
        </div>
        <div>
          <dt className="eyebrow opacity-60">Price</dt>
          <dd className="m-0 mt-1 text-[15px]">
            {shortUsdc(agent.price)} <span className="text-[10px] opacity-60">USDC</span>
          </dd>
        </div>
        <div>
          <dt className="eyebrow opacity-60">Votes</dt>
          <dd className="m-0 mt-1 text-[15px]">{agent.votes}</dd>
        </div>
        <div>
          <dt className="eyebrow opacity-60">Hires</dt>
          <dd className="m-0 mt-1 text-[15px]" title="counted / all hires">
            {agent.hiresCounted}/{agent.hiresTotal}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

export function AgentGrid({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-[18px] max-md:grid-cols-1">
      {agents.map((a) => (
        <AgentCard key={a.key} agent={a} />
      ))}
    </div>
  );
}
