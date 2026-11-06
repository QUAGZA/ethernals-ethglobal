"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AgentSummary, SandboxRefusal, SandboxRunStatus, SandboxRunView, SandboxStepView } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { dateTimeOf, usdc2 } from "@/lib/format";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { PageHeading, Panel, Stat } from "./page-heading";
import { SignInLink } from "./sign-in-gate";
import { FIELD, PRIMARY_BUTTON, ReceiptTable, SECONDARY_BUTTON } from "./task-bits";

const DEFAULT_BUDGET = "0.25";

const REFUSALS: Record<SandboxRefusal, string> = {
  not_on_roster: "Refused: that agent isn't on the roster",
  self_recruit: "Refused: an agent can't recruit itself",
  over_budget: "Refused: over budget",
  no_consent: "Refused: you didn't allow sharing the goal",
  recruit_limit: "Refused: recruit limit reached",
  repeat_recruit: "Refused: the same recruit twice",
  bad_plan: "Refused: the model's plan wasn't valid",
  hire_failed: "The recruit failed, so nothing was charged",
};

const STATUS_TONES: Record<SandboxRunStatus, string> = {
  running: "border-warn text-warn",
  finished: "border-good bg-good text-white",
  incomplete: "border-[#777] bg-[#777] text-white",
  stopped: "border-[#777] text-[#777]",
  failed: "border-bad bg-bad text-white",
};

function RunStatus({ status }: { status: SandboxRunStatus }) {
  return <span className={`eyebrow inline-block border px-2 py-1 ${STATUS_TONES[status]}`}>{status}</span>;
}

function stepLabel(step: SandboxStepView): string {
  if (step.kind === "thought") return "Thought on 0G";
  if (step.kind === "finish") return "Finished";
  if (step.kind === "recruit") return `Recruited ${step.agentEnsName ?? "an agent"} for ${usdc2(step.amountUsdc)} USDC`;
  const label = step.refusal ? REFUSALS[step.refusal] : "Refused";
  return step.agentEnsName ? `${label} (${step.agentEnsName})` : label;
}

function StepRow({ step }: { step: SandboxStepView }) {
  const tone = step.kind === "refused" ? "text-bad" : step.kind === "recruit" ? "font-medium" : step.kind === "thought" ? "opacity-70" : "text-good";
  return (
    <li className="grid grid-cols-[28px_1fr] gap-x-2 border-b border-line py-2 last:border-b-0">
      <span className="tabular-nums opacity-50">{step.n}</span>
      <span className={`break-words ${tone}`}>
        {stepLabel(step)}
        {step.requestId && <span className="block text-[11px] break-all opacity-70">{step.requestId}</span>}
        {step.paymentUrl && (
          <>
            {" "}
            <ExtLink href={step.paymentUrl} className="text-[11px]">
              HashScan
            </ExtLink>
          </>
        )}
      </span>
    </li>
  );
}

function BudgetBar({ run }: { run: SandboxRunView }) {
  const percent = Math.min(100, (Number(run.spentUsdc) / Number(run.budgetUsdc)) * 100);
  return (
    <div>
      <div className="flex justify-between text-[12px]">
        <span>{usdc2(run.spentUsdc)} USDC spent</span>
        <span className="opacity-70">of {usdc2(run.budgetUsdc)}</span>
      </div>
      <div className="mt-1 h-[6px] bg-ink/15" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget spent">
        <div className="h-full bg-yellow" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function RunBoard({ runId, onChanged }: { runId: string; onChanged: () => void }) {
  const loader = useCallback(() => api.sandboxRun(runId), [runId]);
  const run = useLoad(loader, `sandbox:${runId}`);
  const refresh = useDebounced(() => {
    void run.reload();
    onChanged();
  }, 400);
  useEvents((event) => {
    if (event.data.runId === runId) refresh();
  }, ["sandbox.step", "sandbox.done"]);
  const [stopError, setStopError] = useState<ApiRequestError | null>(null);

  async function stop() {
    setStopError(null);
    try {
      await api.stopSandboxRun(runId);
      void run.reload();
    } catch (err) {
      setStopError(toApiError(err));
    }
  }

  const data = run.data;
  if (!data) return <ErrorNotice error={run.error} title="Could not load this run" onRetry={() => void run.reload()} />;

  return (
    <Panel title={`Run · ${data.leadEnsName}`} right={<RunStatus status={data.status} />}>
      {data.brain === "offline" && <p className="m-0 mb-3 border-l-[5px] border-warn bg-warn/10 px-3 py-2">Scripted plan: 0G is off on this server, so nothing here was thought on 0G.</p>}
      {data.goal && <p className="m-0 mb-4 leading-[1.6] whitespace-pre-wrap">{data.goal}</p>}
      <BudgetBar run={data} />
      {data.steps.length === 0 ? (
        <p className="m-0 mt-4 opacity-60">{data.status === "running" ? "The lead agent is thinking…" : "No steps were recorded."}</p>
      ) : (
        <ol className="m-0 mt-4 list-none p-0">
          {data.steps.map((step) => (
            <StepRow key={step.n} step={step} />
          ))}
        </ol>
      )}
      {data.error && <p className="m-0 mt-3 text-bad">{data.error}</p>}
      {data.result && (
        <div className="mt-4 border-t pt-4">
          <p className="eyebrow m-0 mb-2 opacity-60">Result</p>
          <p className="m-0 leading-[1.6] whitespace-pre-wrap">{data.result}</p>
        </div>
      )}
      {data.status !== "running" && !data.result && data.goal === null && (
        <p className="m-0 mt-3 text-[11px] opacity-70">The goal and result aren&apos;t shown here: they go only to the person who started the run, and the server forgets them after an hour.</p>
      )}
      {data.inference.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow m-0 mb-2 opacity-60">Thought on 0G</p>
          <ReceiptTable receipts={data.inference} />
        </div>
      )}
      {data.status === "running" && data.goal !== null && (
        <button className={`${SECONDARY_BUTTON} mt-4`} onClick={() => void stop()}>
          STOP THIS RUN
        </button>
      )}
      <ErrorNotice className="mt-3" error={stopError} />
    </Panel>
  );
}

function StartRunForm({ agents, onStarted }: { agents: AgentSummary[]; onStarted: (id: string) => void }) {
  const [agent, setAgent] = useState("");
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    if (!agent && agents[0]) setAgent(agents[0].label);
  }, [agent, agents]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const run = await api.startSandboxRun({ agent, goal: goal.trim(), budgetUsdc: budget.trim(), shareWithRecruits: share });
      setGoal("");
      onStarted(run.id);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Start a run">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className="eyebrow block">
          Lead agent
          <select className={`${FIELD} cursor-pointer`} value={agent} disabled={busy} onChange={(e) => setAgent(e.target.value)}>
            {agents.map((a) => (
              <option key={a.key} value={a.label}>
                {a.ensName}
              </option>
            ))}
          </select>
        </label>
        <label className="eyebrow block">
          Goal
          <textarea className={`${FIELD} h-28 resize-y`} required minLength={10} maxLength={4000} value={goal} disabled={busy} placeholder="Summarize this report, then translate the summary into Hindi: …" onChange={(e) => setGoal(e.target.value)} />
        </label>
        <label className="eyebrow block">
          Budget (USDC)
          <input className={FIELD} inputMode="decimal" required value={budget} disabled={busy} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="flex cursor-pointer items-start gap-2 leading-[1.5]">
          <input className="mt-1" type="checkbox" checked={share} disabled={busy} onChange={(e) => setShare(e.target.checked)} />
          <span>Let this agent share the goal with the agents it recruits. If this is off, every recruit is refused.</span>
        </label>
        <button type="submit" disabled={busy || !agent} className={PRIMARY_BUTTON}>
          {busy ? "STARTING…" : "START THE RUN →"}
        </button>
        <ErrorNotice error={error} title="The run did not start" />
      </form>
    </Panel>
  );
}

export function SandboxView() {
  const { me } = useApp();
  const loader = useCallback(() => api.sandboxRuns(), []);
  const runs = useLoad(loader, "sandbox-runs");
  const [selected, setSelected] = useState<string | null>(null);
  const reloadRuns = useDebounced(() => void runs.reload(), 500);
  useEvents(reloadRuns, ["sandbox.done"]);

  const limits = runs.data?.[0]?.limits;
  const mine = me?.agents.filter((a) => a.kind === "seller") ?? [];
  const current = selected ?? runs.data?.[0]?.id ?? null;

  return (
    <>
      <PageHeading eyebrow="Sandbox · agents recruit agents" title={<>Give an agent a <em>budget</em>, not a blank cheque.</>}>
        A lead agent works toward your goal and recruits the agents it needs, paying each one over x402 on Hedera. The sandbox runs on our
        server and every decision is made on 0G. Budget, steps, recruits and time are enforced in code, whatever the model says.
      </PageHeading>
      <section className="grid grid-cols-[1fr_1.3fr] gap-[18px] px-[2.2vw] py-[3vw] pb-[6vw] max-md:grid-cols-1 max-md:px-5 max-md:py-8">
        <div className="flex flex-col gap-[18px]">
          {me === undefined ? (
            <p className="eyebrow opacity-60">Checking your session…</p>
          ) : !me.person ? (
            <div className="flex flex-col items-start gap-3">
              <p className="m-0 leading-[1.6]">Sign in to start a run. You can still watch the runs on this page.</p>
              <SignInLink next="/sandbox" />
            </div>
          ) : mine.length === 0 ? (
            <EmptyNote>
              A run needs a lead agent you own. <Link className="border-b" href="/provider">Create one</Link>.
            </EmptyNote>
          ) : (
            <StartRunForm
              agents={mine}
              onStarted={(id) => {
                setSelected(id);
                void runs.reload();
              }}
            />
          )}
          <Panel title="Limits per run">
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Steps" value={limits?.maxSteps ?? 8} />
              <Stat label="Recruits" value={limits?.maxRecruits ?? 3} />
              <Stat label="Time" value={`${(limits?.timeLimitSeconds ?? 300) / 60} min`} />
            </div>
            <p className="m-0 mt-3 text-[11px] leading-[1.5] opacity-70">
              Agents can recruit summarize and translate agents hosted here. Goals and results are never stored; the database keeps only steps, amounts and ids.
            </p>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <ErrorNotice error={runs.error} title="Could not load runs" onRetry={() => void runs.reload()} />
          {current && <RunBoard key={current} runId={current} onChanged={() => void runs.reload()} />}
          {runs.data && runs.data.length === 0 && <EmptyNote>No runs yet.</EmptyNote>}
          {runs.data && runs.data.length > 1 && (
            <Panel title="Recent runs" bodyClassName="">
              <ul className="m-0 list-none p-0">
                {runs.data.map((run) => (
                  <li key={run.id} className="border-b border-line last:border-b-0">
                    <button className={`grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left hover:bg-white ${run.id === current ? "bg-yellow/40" : ""}`} onClick={() => setSelected(run.id)}>
                      <span className="min-w-0 break-all">
                        {run.leadEnsName}
                        <span className="block text-[11px] opacity-60">
                          {dateTimeOf(run.createdAt)} · {usdc2(run.spentUsdc)} USDC
                        </span>
                      </span>
                      <RunStatus status={run.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </section>
    </>
  );
}
