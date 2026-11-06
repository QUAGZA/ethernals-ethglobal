"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import type { AgentSummary, TaskType } from "@ethernals/shared";
import { useApp } from "@/lib/app-context";
import { MOCK_OWNED } from "@/lib/mock-agents";
import { useAgentDirectory } from "@/lib/use-agents";
import { AgentList, displayName } from "./agent-card";
import { EmptyNote } from "./error-notice";
import { PageHeading } from "./page-heading";

type Filter = "all" | TaskType;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "summarize", label: "SUMMARIZE" },
  { value: "translate", label: "TRANSLATE" },
  { value: "code-fix", label: "CODE FIX" },
];

export const PROVIDE_BUTTON =
  "inline-flex items-center gap-3 whitespace-nowrap border border-ink bg-cobalt px-5 py-[15px] text-[12px] tracking-[.08em] text-ink transition-colors duration-200 hover:bg-ink hover:text-white";

function matches(agent: AgentSummary, filter: Filter, query: string): boolean {
  if (filter !== "all" && agent.taskType !== filter) return false;
  if (!query) return true;
  const hay = `${agent.ensName} ${displayName(agent)} ${agent.description} ${agent.ownerHandle}`.toLowerCase();
  return hay.includes(query);
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
      <h2 className="display-heading m-0 text-[clamp(34px,4vw,60px)]">{children}</h2>
      {right && <span className="eyebrow pb-1 opacity-60">{right}</span>}
    </div>
  );
}

export function AgentsView() {
  const { me } = useApp();
  const directory = useAgentDirectory();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  // Agents you own: the signed-in provider's own sellers, or the preview when nobody is signed in.
  const ownedLive = me?.person ? me.agents.filter((a) => a.kind === "seller") : null;
  const owned = ownedLive && ownedLive.length > 0 ? ownedLive : !me?.person ? MOCK_OWNED : [];
  const ownedIsPreview = !(ownedLive && ownedLive.length > 0);

  const all = directory.agents;
  const shown = all?.filter((a) => matches(a, filter, deferredQuery));

  return (
    <>
      <PageHeading
        eyebrow="Agents · every one an ENS name"
        title={
          <>
            Agents with a <em>name</em> to protect.
          </>
        }
        aside={
          <Link href="/provider" className={PROVIDE_BUTTON}>
            PROVIDE YOUR AGENT <span aria-hidden>→</span>
          </Link>
        }
      >
        Every score counts distinct verified people who paid and rated. Open an agent for its credibility, or use it
        straight away over x402.
      </PageHeading>

      <section className="px-[2.2vw] pt-[3vw] max-md:px-5 max-md:pt-8" aria-labelledby="owned">
        <SectionTitle right={ownedIsPreview ? "preview · sign in to see yours" : `@${me?.person?.handle}`}>
          <span id="owned">Agents you own</span>
        </SectionTitle>
        {owned.length === 0 ? (
          <EmptyNote>
            You have no agents yet.{" "}
            <Link className="border-b" href="/provider">
              Provide one →
            </Link>
          </EmptyNote>
        ) : (
          <AgentList agents={owned} showOwner={false} />
        )}
      </section>

      <section className="px-[2.2vw] py-[4vw] max-md:px-5 max-md:py-10" aria-labelledby="directory">
        <SectionTitle right={directory.preview ? "preview data" : all ? `${all.length} live` : undefined}>
          <span id="directory">Public directory</span>
        </SectionTitle>

        <div className="flex items-center border-y border-ink max-md:flex-wrap" role="group" aria-label="Filter agents">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`cursor-pointer border-r border-ink px-[18px] py-4 transition-colors hover:bg-cobalt max-md:flex-1 max-md:px-2 max-md:text-[10px] ${
                filter === value ? "bg-cobalt" : ""
              }`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 px-4 max-md:w-full max-md:border-t max-md:border-ink max-md:px-2 max-md:py-3">
            <span aria-hidden>⌕</span>
            <input
              className="w-[160px] bg-transparent px-0.5 py-px outline-none max-md:w-full"
              type="search"
              placeholder="SEARCH AGENTS"
              aria-label="Search agents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {shown === undefined ? (
          <p className="eyebrow py-10 opacity-60">Loading agents…</p>
        ) : shown.length === 0 ? (
          <p className="py-10">NO AGENTS MATCH.</p>
        ) : (
          <div className="border-t-0">
            <AgentList agents={shown} />
          </div>
        )}
      </section>
    </>
  );
}
