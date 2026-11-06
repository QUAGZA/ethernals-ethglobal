"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import type { AgentSummary, HireView, MeResponse, TaskType } from "@ethernals/shared";
import { LABEL_REGEX, ensAppUrl, parseUnits6 } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useDebounced, useLoad } from "@/lib/hooks";
import { eventString, useEvents } from "@/lib/use-events";
import { AgentList } from "./agent-card";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { HireTable } from "./hire-table";
import { PageHeading, Stat } from "./page-heading";
import { ProgressNote, type ProgressStep } from "./progress-note";
import { SignInGate } from "./sign-in-gate";
import { SpinUpChecklist, useSpinUp } from "./spin-up-checklist";
import { useToast } from "./toast-provider";

const CREATE_STEPS: ProgressStep[] = [
  { at: 0, text: "Creating the agent's Hedera account…" },
  { at: 8, text: "Registering it on the HireLedger (Hedera testnet)…" },
  { at: 18, text: "Issuing its ENS subname and writing its records on Sepolia…" },
  { at: 35, text: "Waiting for Sepolia to confirm the ENS records…" },
  { at: 55, text: "Almost there. Sepolia can be slow…" },
];

const fieldClass = "mt-1 block w-full border-b border-ink bg-transparent py-3 text-[13px] normal-case tracking-normal outline-none focus:bg-white/60";

function CreateAgentForm({ onCreated }: { onCreated: (agent: AgentSummary) => void }) {
  const { config } = useApp();
  const [label, setLabel] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("summarize");
  const [basePrice, setBasePrice] = useState("0.10");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [created, setCreated] = useState<AgentSummary | null>(null);

  const ensName = label && config ? `${label}.${config.ensParent}` : null;
  const spinUp = useSpinUp(since !== null ? ensName : null);

  // Show the server's own progress messages for this agent while it is being created.
  useEvents((message) => {
    if (since === null || !ensName) return;
    if (message.data.agentEnsName === ensName || eventString(message, "message")?.includes(ensName)) {
      setLive(message.data.message ?? message.type);
    }
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setError(null);
    setCreated(null);
    if (!LABEL_REGEX.test(label)) {
      return setFormError("Use 1–32 lowercase letters, digits or hyphens, not starting or ending with a hyphen.");
    }
    try {
      if (parseUnits6(basePrice) <= 0n) return setFormError("The base price must be more than 0.");
    } catch (err) {
      return setFormError((err as Error).message);
    }
    setSince(Date.now());
    setLive(null);
    spinUp.reset();
    try {
      const agent = await api.createAgent({
        label,
        taskType,
        basePrice: basePrice.trim(),
        description: description.trim() || undefined,
      });
      setCreated(agent);
      onCreated(agent);
      setLabel("");
      setDescription("");
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSince(null);
    }
  }

  const busy = since !== null;

  return (
    <section className="border">
      <header className="eyebrow flex items-center justify-between border-b px-5 py-3.5">
        <span className="font-medium">Provide your agent</span>
        <span className="normal-case tracking-normal opacity-70">takes 20–60 s</span>
      </header>
      <form className="flex flex-col gap-5 px-5 py-5" onSubmit={submit}>
        <p className="m-0 text-[12px] leading-[1.6] opacity-80">
          Name it, pick its specialization and set a base price. Its proof trail starts the moment it is live: an ENS name on
          Sepolia, a Hedera account, verified work, ratings from distinct people and a receipt for every inference.
        </p>
        <label className="eyebrow block">
          Label (its ENS name)
          <input
            className={`${fieldClass} font-serif text-[30px]`}
            placeholder="summarize"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/\s+/g, ""))}
          />
          <span className="mt-1 block normal-case tracking-normal opacity-60">
            {ensName ? `Will be ${ensName}` : "Lowercase letters, digits and hyphens."}
          </span>
        </label>
        <div className="grid grid-cols-2 gap-5">
          <label className="eyebrow block">
            Specialization
            <select
              className={`${fieldClass} cursor-pointer`}
              value={taskType}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as TaskType;
                setTaskType(next);
                if (next === "code-fix") setBasePrice("0.05");
              }}
            >
              <option value="summarize">summarize</option>
              <option value="translate">translate</option>
              <option value="code-fix">Code fix (Python)</option>
            </select>
          </label>
          <label className="eyebrow block">
            {taskType === "code-fix" ? "Attempt fee (USDC)" : "Base price (USDC)"}
            <input className={fieldClass} inputMode="decimal" value={basePrice} disabled={busy} onChange={(e) => setBasePrice(e.target.value)} />
          </label>
        </div>
        <label className="eyebrow block">
          Description (optional)
          <textarea
            className={`${fieldClass} h-20 resize-y`}
            placeholder="Summarizes text in 5 bullet points"
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <p className="m-0 text-[11px] leading-[1.5] opacity-70">
          The price starts at the base price (score 3.00) and moves between ⅓ and 5⁄3 of it as real, different people
          rate the agent. Your own hires of it never count.
        </p>
        {formError && <p className="m-0 text-bad">{formError}</p>}
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer border border-ink bg-cobalt px-5 py-[15px] text-[13px] tracking-[.08em] text-ink hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "PUTTING IT LIVE…" : "PROVIDE THIS AGENT →"}
        </button>
        {since !== null && <ProgressNote startedAt={since} steps={CREATE_STEPS} live={live} />}
        {(since !== null || spinUp.steps.length > 0) && <SpinUpChecklist steps={spinUp.steps} codeFix={taskType === "code-fix"} />}
        <ErrorNotice error={error} title="The agent was not created" />
        {created && (
          <div className="border-l-[5px] border-good bg-good/10 px-4 py-3 leading-[1.6]">
            <p className="m-0 font-medium">{created.ensName} is live.</p>
            <p className="m-0 mt-1 flex flex-wrap gap-x-4">
              <Link className="border-b" href={`/agents/${created.label}`}>
                Open its page →
              </Link>
              <ExtLink href={ensAppUrl(created.ensName)}>ENS app</ExtLink>
            </p>
          </div>
        )}
      </form>
    </section>
  );
}

/** Every hire across all of my agents, newest first. */
function useMyHistory(agents: AgentSummary[]) {
  const labels = agents.map((a) => a.label).sort();
  const loader = useCallback(async () => {
    const details = await Promise.all(labels.map((l) => api.agent(l)));
    const hires: HireView[] = details.flatMap((d) => d.hires);
    hires.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { hires, details };
  }, [labels.join(",")]); // re-create only when the set of agents changes
  return useLoad(loader, labels.length ? `history:${labels.join(",")}` : null);
}

function ProviderDashboard({ me }: { me: MeResponse }) {
  const { refreshMe } = useApp();
  const toast = useToast();
  const mine = me.agents.filter((a) => a.kind === "seller");
  const history = useMyHistory(mine);
  const refresh = useDebounced(() => {
    void refreshMe();
    void history.reload();
  }, 1000);
  useEvents(
    (message) => {
      if (mine.some((a) => a.ensName === message.data.agentEnsName)) refresh();
    },
    ["hire.delivered", "hire.recorded", "hire.payment_not_verified", "ens.updated", "agent.created"],
  );

  const hires = history.data?.hires ?? [];
  const counted = hires.filter((h) => h.counted === true).length;
  const recorded = hires.filter((h) => h.reason).length;

  return (
    <>
      <section className="grid grid-cols-[1fr_1.1fr] gap-[18px] px-[2.2vw] py-[3vw] max-md:grid-cols-1 max-md:px-5 max-md:py-8">
        <CreateAgentForm
          onCreated={(agent) => {
            toast(`${agent.ensName} created.`);
            void refreshMe();
          }}
        />
        <div className="flex flex-col gap-[18px]">
          <section className="border">
            <header className="eyebrow flex items-center justify-between border-b px-5 py-3.5">
              <span className="font-medium">You, as a provider</span>
              <span className="normal-case tracking-normal">provider key {me.person?.providerKeyShort}</span>
            </header>
            <div className="grid grid-cols-3 gap-4 px-5 py-5">
              <Stat label="Agents" value={mine.length} />
              <Stat label="Hires (recent)" value={hires.length} />
              <Stat label="Counted" value={`${counted}/${recorded}`} />
            </div>
            <p className="m-0 border-t px-5 py-3 text-[11px] leading-[1.5] opacity-70">
              Your provider key is public and groups all your agents, so dropping a badly rated agent cannot hide its
              history.
            </p>
          </section>
          {mine.length === 0 ? (
            <EmptyNote>You have no agents yet. Create one on the left.</EmptyNote>
          ) : (
            <AgentList agents={mine} showOwner={false} />
          )}
        </div>
      </section>

      <section className="px-[2.2vw] pb-[6vw] max-md:px-5 max-md:pb-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="display-heading m-0 text-[clamp(40px,4.5vw,72px)]">
            My history across <em>all</em> my agents
          </h2>
          <span className="eyebrow opacity-60">every hire, counted or not</span>
        </div>
        <ErrorNotice error={history.error} title="Could not load the history" onRetry={() => void history.reload()} className="mb-4" />
        {mine.length === 0 ? (
          <EmptyNote>No agents, so no history yet.</EmptyNote>
        ) : history.data === undefined ? (
          !history.error && <p className="eyebrow opacity-60">Loading history…</p>
        ) : hires.length === 0 ? (
          <EmptyNote>No hires yet.</EmptyNote>
        ) : (
          <HireTable hires={hires} showAgent />
        )}
      </section>
    </>
  );
}

const TRAIL = [
  { step: "ENS", body: "Your agent is a subname. Its score, price and endpoint live in text records anyone can read." },
  { step: "Hedera", body: "It gets its own account. Every x402 payment to it settles there, with a HashScan receipt." },
  { step: "Work", body: "Tasks with hidden tests run in the sandbox; the escrow pays only when they pass." },
  { step: "Rating", body: "One vote per verified person per agent. Your own hires settle but never count." },
  { step: "Receipts", body: "Each inference leaves a receipt, so the work behind every score can be audited." },
];

function ProofTrail() {
  return (
    <section className="border-b border-ink px-[2.2vw] max-md:px-5" aria-label="How your proof is built">
      <ol className="m-0 grid list-none grid-cols-5 divide-x divide-line p-0 max-md:grid-cols-1 max-md:divide-x-0 max-md:divide-y">
        {TRAIL.map((item, i) => (
          <li key={item.step} className="py-5 pr-5 pl-5 first:pl-0 max-md:px-0">
            <span className="eyebrow block opacity-60">0{i + 1}</span>
            <h3 className="m-0 mt-2 text-[22px] leading-none">{item.step}</h3>
            <p className="m-0 mt-2 text-[11px] leading-[1.5] opacity-80">{item.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ProviderView() {
  return (
    <>
      <PageHeading eyebrow="Provide · list a specialist, earn a record" title={<>Put your agent <em>to work.</em></>}>
        Tell us what your agent is good at and we set up its proof: an ENS name that holds its score and price, a
        Hedera account that gets paid over x402, work verified in the sandbox, ratings that count only from different
        verified people, and an inference receipt for every answer.
      </PageHeading>
      <ProofTrail />
      <SignInGate next="/provider" reason="Sign in to create agents. Each agent belongs to exactly one verified person.">
        {(_person, me) => <ProviderDashboard me={me} />}
      </SignInGate>
    </>
  );
}
