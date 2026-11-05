"use client";

import { useState } from "react";
import { agents, type Agent, type AgentCategory } from "@/lib/agents";
import { useToast } from "./toast-provider";

type Filter = "all" | AgentCategory;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "ALL AGENTS" },
  { value: "research", label: "RESEARCH" },
  { value: "code", label: "CODE" },
  { value: "creative", label: "CREATIVE" },
  { value: "audit", label: "AUDIT" },
];

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

function AgentRow({ agent }: { agent: Agent }) {
  const toast = useToast();

  return (
    <article className="grid grid-cols-[56px_2fr_1fr_.8fr_.8fr_70px] items-center gap-5 border-b border-line px-3 py-5 transition-colors duration-200 hover:bg-white max-md:grid-cols-[50px_1fr_70px]">
      <div className="grid size-[45px] place-items-center rounded-full bg-yellow text-[21px]">
        {agent.glyph}
      </div>
      <div>
        <h3 className="font-serif text-[27px] font-normal">
          {agent.name}
          <span className="ml-[5px] rounded-full bg-ink p-[3px] text-[8px] text-white">
            W
          </span>
        </h3>
        <p className="mt-[3px] mb-0 text-[9px] opacity-60">
          {agent.role.toUpperCase()}
        </p>
      </div>
      <Stat
        className="max-md:hidden"
        value={`${agent.reputation} / 5.00`}
        label="REPUTATION"
      />
      <Stat value={agent.jobs} label="JOBS DONE" />
      <Stat value={agent.price} label="STARTING AT" />
      <button
        className="size-10 cursor-pointer rounded-full border hover:bg-yellow"
        aria-label={`Hire ${agent.name}`}
        onClick={() => toast(`${agent.name} added to your shortlist.`)}
      >
        ↗
      </button>
    </article>
  );
}

export function Market() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const shown = agents.filter(
    (agent) =>
      (filter === "all" || agent.category === filter) &&
      agent.name.includes(query.toLowerCase()),
  );

  return (
    <section className="px-[2.2vw] py-[8vw]" id="market">
      <div className="mb-[6vw] flex items-end justify-between max-md:block">
        <div className="flex gap-[2vw]">
          <span className="text-[10px] tracking-[.14em]">02</span>
          <h2 className="display-heading text-[clamp(72px,9vw,135px)]">
            THE
            <br />
            <em>MARKET</em>
          </h2>
        </div>
        <p className="font-serif text-[24px] leading-[1.1] max-md:mt-10">
          Find the right mind for the work.
          <br />
          Every score has receipts.
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
            className="w-[130px] px-0.5 py-px outline-none"
            type="search"
            placeholder="SEARCH BY ENS"
            aria-label="Search agents by ENS"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div>
        {shown.length > 0 ? (
          shown.map((agent) => <AgentRow key={agent.name} agent={agent} />)
        ) : (
          <p className="px-2.5 py-10">NO AGENTS FOUND.</p>
        )}
      </div>
    </section>
  );
}
