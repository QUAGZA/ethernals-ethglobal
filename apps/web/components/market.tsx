"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import type { TaskType } from "@ethernals/shared";
import { useAgentDirectory } from "@/lib/use-agents";
import { AgentList, displayName } from "./agent-card";

type Filter = "all" | TaskType;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "ALL AGENTS" },
  { value: "summarize", label: "SUMMARIZE" },
  { value: "translate", label: "TRANSLATE" },
  { value: "code-fix", label: "CODE FIX" },
];

export function Market() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const directory = useAgentDirectory();

  const shown = directory.agents?.filter(
    (agent) =>
      (filter === "all" || agent.taskType === filter) &&
      (!q || `${agent.ensName} ${displayName(agent)}`.toLowerCase().includes(q)),
  );

  return (
    <section className="cv-auto px-[2.2vw] py-[8vw] max-md:px-5 max-md:py-16" id="market">
      <div className="mb-[5vw] flex items-end justify-between gap-8 max-md:mb-10 max-md:block">
        <div className="flex gap-[2vw]">
          <span className="eyebrow">02</span>
          <h2 className="display-heading text-[clamp(64px,9vw,135px)]">
            THE
            <br />
            MARKET
          </h2>
        </div>
        <p className="m-0 font-serif text-[clamp(18px,1.8vw,24px)] leading-[1.15] max-md:mt-8">
          Every score is a count of real people.
          <br />
          Every hire has a receipt on HashScan.
        </p>
      </div>

      <div className="flex items-center border-y border-ink max-md:flex-wrap" role="group" aria-label="Filter agents">
        {filters.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`cursor-pointer border-r border-ink px-[22px] py-5 transition-colors hover:bg-cobalt max-md:flex-1 max-md:px-2 max-md:py-4 max-md:text-[10px] ${
              filter === value ? "bg-cobalt" : ""
            }`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 px-4 max-md:hidden">
          <span aria-hidden>⌕</span>
          <input
            className="w-[140px] bg-transparent px-0.5 py-px outline-none"
            type="search"
            placeholder="SEARCH BY NAME"
            aria-label="Search agents by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {shown === undefined ? (
        <p className="px-2.5 py-10 opacity-60">LOADING AGENTS…</p>
      ) : shown.length === 0 ? (
        <p className="px-2.5 py-10">NO AGENTS MATCH.</p>
      ) : (
        <AgentList agents={shown} />
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="eyebrow opacity-60">{directory.preview ? "preview data" : "live from the hireledger"}</span>
        <Link className="border-b border-ink pb-[5px]" href="/agents">
          ALL AGENTS →
        </Link>
      </div>
    </section>
  );
}
