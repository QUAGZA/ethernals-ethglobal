"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import type { AgentSummary, AgentToolId, HireView, MeResponse, TaskType } from "@ethernals/shared";
import { AGENT_TOOLS, LABEL_REGEX, ensAppUrl, parseUnits6 } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useDebounced, useLoad } from "@/lib/hooks";
import { eventString, useEvents } from "@/lib/use-events";
import { AgentGrid } from "./agent-card";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { HireTable } from "./hire-table";
import { PageHeading, Stat } from "./page-heading";
import { ProgressNote, type ProgressStep } from "./progress-note";
import { SignInGate } from "./sign-in-gate";
import { useToast } from "./toast-provider";

const CREATE_STEPS: ProgressStep[] = [
  { at: 0, text: "Creating the agent's Hedera account…" },
  { at: 8, text: "Registering it on the HireLedger (Hedera testnet)…" },
  { at: 18, text: "Issuing its ENS subname and writing its records on Sepolia…" },
  { at: 35, text: "Waiting for Sepolia to confirm the ENS records…" },
  { at: 55, text: "Almost there. Sepolia can be slow…" },
];

const TOOL_HELP: Record<AgentToolId, string> = {
  calculator: "Exact arithmetic instead of the model guessing numbers.",
  fetch_url: "Read a public https web page or JSON (private networks are blocked).",
  current_time: "Know the current date and time.",
  hire_agent: "Pay other agents on the marketplace for sub-tasks, only if the customer allows it and within their sub-budget.",
};

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
  // Custom (hosted) agent: the hoster brings their own 0G key, a specialization and tools.
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [tools, setTools] = useState<AgentToolId[]>([]);
  const [keyCheck, setKeyCheck] = useState<{ ok: boolean; text: string; models: string[] } | null>(null);
  const [testing, setTesting] = useState(false);

  const ensName = label && config ? `${label}.${config.ensParent}` : null;

  // Show the server's own progress messages for this agent while it is being created.
  useEvents((message) => {
    if (since === null || !ensName) return;
    if (message.data.agentEnsName === ensName || eventString(message, "message")?.includes(ensName)) {
      setLive(message.data.message ?? message.type);
    }
  });

  async function testKey() {
    setTesting(true);
    setKeyCheck(null);
    try {
      const r = await api.testBrain({ apiKey: apiKey.trim(), model: model.trim() || undefined });
      setKeyCheck({ ok: true, text: `Key works. Model ${r.model}, request id ${r.requestId ?? "n/a"}.`, models: r.models });
    } catch (err) {
      setKeyCheck({ ok: false, text: toApiError(err).message, models: [] });
    } finally {
      setTesting(false);
    }
  }

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
    if (taskType === "custom") {
      if (!apiKey.trim()) return setFormError("Enter your 0G API key. It pays for this agent's thinking.");
      if (systemPrompt.trim().length < 20) return setFormError("Describe what this agent is specialized in (at least a sentence).");
    }
    setSince(Date.now());
    setLive(null);
    try {
      const agent = await api.createAgent({
        label,
        taskType,
        basePrice: basePrice.trim(),
        description: description.trim() || undefined,
        brain: taskType === "custom" ? { provider: "0g", apiKey: apiKey.trim(), model: model.trim() || undefined, systemPrompt: systemPrompt.trim(), tools } : undefined,
      });
      setCreated(agent);
      onCreated(agent);
      setLabel("");
      setDescription("");
      setApiKey("");
      setKeyCheck(null);
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
        <span className="font-medium">Create an agent to host</span>
        <span className="normal-case tracking-normal opacity-70">takes 20–60 s</span>
      </header>
      <form className="flex flex-col gap-5 px-5 py-5" onSubmit={submit}>
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
            Task type
            <select
              className={`${fieldClass} cursor-pointer`}
              value={taskType}
              disabled={busy}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
            >
              <option value="summarize">summarize</option>
              <option value="translate">translate</option>
              <option value="custom">custom: my own agent on 0G</option>
            </select>
          </label>
          <label className="eyebrow block">
            Base price (USDC)
            <input className={fieldClass} inputMode="decimal" value={basePrice} disabled={busy} onChange={(e) => setBasePrice(e.target.value)} />
          </label>
        </div>
        {taskType === "custom" && (
          <div className="flex flex-col gap-5 border bg-white/40 p-4">
            <p className="m-0 text-[11px] leading-[1.5] opacity-70">
              You host this agent: it thinks on 0G using <b>your own</b> 0G account, so the inference cost is yours and
              your earnings are the price customers pay. Your key is checked, stored encrypted on the server, used only
              to run this agent&apos;s tasks, and is never shown again.
            </p>
            <label className="eyebrow block">
              Your 0G API key (sk-…)
              <input
                className={fieldClass}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                value={apiKey}
                disabled={busy}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyCheck(null);
                }}
              />
            </label>
            <label className="eyebrow block">
              Model (optional)
              <input className={fieldClass} placeholder="empty = 0gm-1.0-35b-a3b" list="zg-models" value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} />
              <datalist id="zg-models">
                {(keyCheck?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <div>
              <button type="button" disabled={busy || testing || !apiKey.trim()} onClick={() => void testKey()} className="cursor-pointer border border-ink px-4 py-2 text-[11px] tracking-[.08em] hover:bg-ink hover:text-yellow disabled:cursor-not-allowed disabled:opacity-40">
                {testing ? "TESTING…" : "TEST KEY + MODEL"}
              </button>
              {keyCheck && <p className={`m-0 mt-2 text-[12px] ${keyCheck.ok ? "text-good" : "text-bad"}`}>{keyCheck.text}</p>}
            </div>
            <label className="eyebrow block">
              Specialization (what makes this agent good at its job)
              <textarea
                className={`${fieldClass} h-28 resize-y`}
                placeholder="You are a contract-clause reviewer. Quote the clause, rate its risk low/medium/high, and suggest safer wording."
                value={systemPrompt}
                disabled={busy}
                maxLength={4000}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </label>
            <fieldset className="m-0 border-0 p-0">
              <legend className="eyebrow mb-2">Tools</legend>
              {AGENT_TOOLS.map((t) => (
                <label key={t} className="mb-1 flex cursor-pointer items-start gap-3 text-[12px] leading-[1.5]">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-ink"
                    checked={tools.includes(t)}
                    disabled={busy}
                    onChange={(e) => setTools(e.target.checked ? [...tools, t] : tools.filter((x) => x !== t))}
                  />
                  <span>
                    <b>{t}</b>
                    <span className="block opacity-60">{TOOL_HELP[t]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        )}
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
          className="cursor-pointer border border-ink bg-yellow px-5 py-[15px] text-[13px] tracking-[.08em] text-ink hover:bg-ink hover:text-yellow disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "CREATING…" : "CREATE AGENT →"}
        </button>
        {since !== null && <ProgressNote startedAt={since} steps={CREATE_STEPS} live={live} />}
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
            <AgentGrid agents={mine} />
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

export function ProviderView() {
  return (
    <>
      <PageHeading eyebrow="Provide · run agents, earn a record" title={<>Earn a record you <em>can&apos;t</em> fake.</>}>
        Host an agent: give it a specialization and tools and run it on your own 0G account (or pick summarize/translate).
        It gets its own ENS name and Hedera account. Its score and price move only when different verified people pay
        for it and rate it.
      </PageHeading>
      <SignInGate next="/provider" reason="Sign in to create agents. Each agent belongs to exactly one verified person.">
        {(_person, me) => <ProviderDashboard me={me} />}
      </SignInGate>
    </>
  );
}
