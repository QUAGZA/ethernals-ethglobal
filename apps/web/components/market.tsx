"use client";

import Link from "next/link";
import { useState } from "react";
import type { AgentSummary, TaskType } from "@ethernals/shared";
import { api } from "@/lib/api";
import { shortUsdc } from "@/lib/format";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EmptyNote, ErrorNotice } from "./error-notice";

type Filter = "all" | TaskType;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "ALL AGENTS" },
  { value: "summarize", label: "SUMMARIZE" },
  { value: "translate", label: "TRANSLATE" },
];

const glyphs: Record<TaskType, string> = { summarize: "≡", translate: "⇄", "code-fix": "⌘" };

function Stat({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <strong className="block text-[12px]">{value}</strong>
      <small className="text-[9px] opacity-60">{label}</small>
    </div>
  );
}

function AgentRow({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      href={`/agents/${agent.label}`}
      className="group grid grid-cols-[56px_2fr_1fr_.8fr_.8fr_70px] items-center gap-5 border-b border-line px-3 py-5 transition-colors duration-200 hover:bg-white max-md:grid-cols-[50px_1fr_70px]"
    >
      <div className="grid size-[45px] place-items-center rounded-full bg-yellow text-[21px]">
        {agent.taskType ? glyphs[agent.taskType] : "•"}
      </div>
      <div className="min-w-0">
        <h3 className="m-0 truncate font-serif text-[27px] font-normal">
          {agent.ensName}
          <span className="ml-[5px] rounded-full bg-ink p-[3px] align-middle text-[8px] text-white" title="Owner verified with World ID">
            W
          </span>
        </h3>
        <p className="mt-[3px] mb-0 truncate text-[9px] opacity-60">
          {(agent.description || agent.taskType || "agent").toUpperCase()} · BY @{agent.ownerHandle.toUpperCase()}
        </p>
      </div>
      <Stat className="max-md:hidden" value={`${agent.score} / 5.00`} label={`SCORE · ${agent.votes} ${agent.votes === 1 ? "VOTE" : "VOTES"}`} />
      <Stat className="max-md:hidden" value={`${agent.hiresCounted} / ${agent.hiresTotal}`} label="COUNTED / ALL HIRES" />
      <Stat className="max-md:hidden" value={`${shortUsdc(agent.price)} USDC`} label="PRICE PER TASK" />
      <span
        className="grid size-10 place-items-center rounded-full border group-hover:bg-yellow"
        aria-hidden
      >
        ↗
      </span>
    </Link>
  );
}

export function Market() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const agents = useLoad(api.agents, "agents");
  const refresh = useDebounced(() => void agents.reload(), 1000);
  useEvents(refresh, ["agent.created", "hire.recorded", "ens.updated"]);

  const list = (agents.data ?? []).filter((a) => a.kind === "seller");
  const shown = list.filter(
    (agent) =>
      (filter === "all" || agent.taskType === filter) &&
      agent.ensName.includes(query.trim().toLowerCase()),
  );

  return (
    <section className="px-[2.2vw] py-[8vw] max-md:px-5" id="market">
      <div className="mb-[6vw] flex items-end justify-between max-md:block">
        <div className="flex gap-[2vw]">
          <span className="eyebrow">02</span>
          <h2 className="display-heading text-[clamp(72px,9vw,135px)]">
            THE
            <br />
            <em>MARKET</em>
          </h2>
        </div>
        <p className="font-serif text-[24px] leading-[1.1] max-md:mt-10">
          Every score is a count of real people.
          <br />
          Every hire has a receipt on HashScan.
        </p>
      </div>

      <div
        className="flex items-center border-y max-md:overflow-x-auto"
        role="group"
        aria-label="Filter agents"
      >
        {filters.map(({ value, label }) => (
          <button
            key={value}
            className={`cursor-pointer border-r px-[22px] py-5 hover:bg-yellow ${
              filter === value ? "bg-yellow" : ""
            }`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 px-4 max-md:hidden">
          <span>⌕</span>
          <input
            className="w-[130px] bg-transparent px-0.5 py-px outline-none"
            type="search"
            placeholder="SEARCH BY ENS"
            aria-label="Search agents by ENS"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div>
        {agents.error && !agents.data ? (
          <ErrorNotice className="mt-6" title="Could not load agents" error={agents.error} onRetry={() => void agents.reload()} />
        ) : agents.data === undefined ? (
          <p className="px-2.5 py-10 opacity-60">LOADING AGENTS…</p>
        ) : list.length === 0 ? (
          <EmptyNote className="mt-6">
            No agents yet. A provider can create one on{" "}
            <Link className="border-b" href="/provider">
              /provider
            </Link>
            .
          </EmptyNote>
        ) : shown.length > 0 ? (
          shown.map((agent) => <AgentRow key={agent.key} agent={agent} />)
        ) : (
          <p className="px-2.5 py-10">NO AGENTS MATCH.</p>
        )}
      </div>
      <div className="mt-6 flex justify-end">
        <Link className="border-b pb-[5px]" href="/agents">
          ALL AGENTS →
        </Link>
      </div>
    </section>
  );
}
