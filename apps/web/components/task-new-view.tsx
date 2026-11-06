"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DRAFT_TEST_PATH, type CalibrationReport, type CreateTaskRequest } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useElapsed, useLoad } from "@/lib/hooks";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { PageHeading, Panel } from "./page-heading";
import { SignInGate } from "./sign-in-gate";
import { CalibrationSummary, FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON, SpendBanner } from "./task-bits";
import { useToast } from "./toast-provider";

const DEFAULT_BOUNTY = "2.00";

export interface SpecialistOption {
  ensName: string;
  label: string;
  score: string;
  price: string;
  tasksPassed: number;
  status: "awake" | "dormant";
}

/** Code-fix agents with their score, price, verified tasks and brain status. */
export function useSpecialists() {
  const loader = useCallback(async (): Promise<SpecialistOption[]> => {
    // Agents hosted elsewhere can't take a task from this server, and have no local brain to read.
    const agents = (await api.agents()).filter((a) => a.taskType === "code-fix" && !a.remote);
    return Promise.all(
      agents.map(async (agent) => {
        const [detail, brain] = await Promise.all([api.agent(agent.label), api.agentBrain(agent.label)]);
        return { ensName: agent.ensName, label: agent.label, score: agent.score, price: agent.price, tasksPassed: detail.tasksPassed, status: brain.status };
      }),
    );
  }, []);
  return useLoad(loader, "specialists");
}

export function SpecialistPicker({ options, value, onChange }: { options: SpecialistOption[]; value: string; onChange: (ensName: string) => void }) {
  return (
    <div className="flex flex-col border-t">
      {options.map((option) => (
        <label key={option.ensName} className={`grid cursor-pointer grid-cols-[22px_1fr_auto] items-center gap-3 border-b px-3 py-3 ${value === option.ensName ? "bg-cobalt" : "hover:bg-white"} ${option.status === "dormant" ? "opacity-50" : ""}`}>
          <input type="radio" name="specialist" checked={value === option.ensName} disabled={option.status === "dormant"} onChange={() => onChange(option.ensName)} />
          <span>
            <span className="font-serif text-[20px]">{option.ensName}</span>
            <span className="block text-[11px] opacity-70">
              score {option.score} · attempt fee {option.price} USDC · {option.tasksPassed} verified tasks passed
            </span>
          </span>
          <span className={`eyebrow ${option.status === "awake" ? "text-good" : "text-bad"}`}>{option.status}</span>
        </label>
      ))}
    </div>
  );
}

function NewTaskForm() {
  const router = useRouter();
  const toast = useToast();
  const templates = useLoad(useCallback(() => api.taskTemplates(), []), "templates");
  const specialists = useSpecialists();
  const spend = useLoad(useCallback(() => api.spend(), []), "spend-new-task");

  const [bounty, setBounty] = useState(DEFAULT_BOUNTY);
  const [minutes, setMinutes] = useState("30");
  const [specialist, setSpecialist] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [custom, setCustom] = useState({ title: "", repoUrl: "", baseCommit: "", issue: "", tests: "", referencePatch: "", naivePatch: "" });
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [draftStartedAt, setDraftStartedAt] = useState<number | null>(null);
  const [draftError, setDraftError] = useState<ApiRequestError | null>(null);
  const draftElapsed = useElapsed(draftStartedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  // An agent's page links here with that agent already picked.
  useEffect(() => {
    const picked = new URLSearchParams(window.location.search).get("specialist");
    if (picked) setSpecialist(picked);
  }, []);

  const template = templates.data?.[0];
  const drafting = draftStartedAt !== null;
  const canDraft = Boolean(custom.repoUrl.trim() && custom.baseCommit.trim() && custom.issue.trim()) && !drafting && !busy;

  /** A report only describes what it checked, so any edit but the title clears it. */
  function editCustom(fields: Partial<typeof custom>) {
    setCustom((current) => ({ ...current, ...fields }));
    if (!("title" in fields)) setReport(null);
  }

  async function draftWithAgent() {
    setDraftStartedAt(Date.now());
    setDraftError(null);
    try {
      const draft = await api.draftTests({ repoUrl: custom.repoUrl.trim(), baseCommit: custom.baseCommit.trim(), issue: custom.issue.trim() });
      setCustom((current) => ({ ...current, tests: draft.tests, referencePatch: draft.referencePatch, naivePatch: draft.naivePatch ?? "" }));
      setReport(draft.calibration);
    } catch (err) {
      setDraftError(toApiError(err));
    } finally {
      setDraftStartedAt(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBlocked(null);
    const base = { bounty: bounty.trim(), deadlineMinutes: Number(minutes), specialist: specialist || undefined };
    const body: CreateTaskRequest = advanced
      ? {
          ...base,
          spec: { title: custom.title.trim(), repoUrl: custom.repoUrl.trim(), baseCommit: custom.baseCommit.trim(), issue: custom.issue.trim() },
          hiddenTests: { files: [{ path: DRAFT_TEST_PATH, content: custom.tests }] },
          checks: { referencePatch: custom.referencePatch || undefined, naivePatch: custom.naivePatch || undefined },
        }
      : { ...base, template: "slugify" };
    try {
      const task = await api.createTask(body);
      toast("Bounty locked in escrow.");
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.status === 409 && apiError.message.startsWith("Blocked by")) setBlocked(apiError.message);
      else setError(apiError);
    } finally {
      setBusy(false);
      void spend.reload();
    }
  }

  return (
    <form className="grid grid-cols-[1.2fr_1fr] gap-[18px] px-[2.2vw] py-[3vw] max-md:grid-cols-1 max-md:px-5 max-md:py-8" onSubmit={submit}>
      <div className="flex flex-col gap-[18px]">
        <Panel title="Task">
          {!advanced &&
            (template ? (
              <>
                <h2 className="m-0 font-serif text-[30px] font-normal">Fix the slugify bug (Python, hidden tests)</h2>
                <p className="mt-2 mb-0 leading-[1.6] whitespace-pre-wrap">{template.issue}</p>
                <p className="m-0 mt-2 text-[11px] break-all opacity-60">{template.repoUrl}</p>
              </>
            ) : templates.data ? (
              <EmptyNote>The demo task is not on this server yet. Use a custom repo below, or merge main to get demo/tasks/slugify.</EmptyNote>
            ) : (
              <ErrorNotice error={templates.error} title="Could not load the template" onRetry={() => void templates.reload()} />
            ))}
          <label className="mt-4 flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            Use a custom repo
          </label>
          {advanced && (
            <div className="mt-3 flex flex-col gap-3">
              {(
                [
                  ["title", "Title", "Fix the date parser"],
                  ["repoUrl", "Repository", "https://github.com/owner/repo"],
                  ["baseCommit", "Commit (full SHA)", ""],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key} className="eyebrow block">
                  {label}
                  <input className={FIELD} placeholder={placeholder} required value={custom[key]} onChange={(e) => editCustom({ [key]: e.target.value })} />
                </label>
              ))}
              <label className="eyebrow block">
                Issue
                <textarea className={`${FIELD} h-24 resize-y`} required value={custom.issue} onChange={(e) => editCustom({ issue: e.target.value })} />
              </label>
              <div>
                <button type="button" className={SECONDARY_BUTTON} disabled={!canDraft} onClick={() => void draftWithAgent()}>
                  {drafting ? `DRAFTING AND CHECKING… ${draftElapsed}s` : "DRAFT TESTS WITH MY AGENT"}
                </button>
                <p className="m-0 mt-2 text-[11px] leading-[1.5] opacity-70">
                  Your agent reads the repo on 0G and writes tests, plus a fix and a shallow fix to check them against. Read them before you fund: this can take a few minutes.
                </p>
                <ErrorNotice className="mt-3" error={draftError} title="No draft" />
              </div>
              <label className="eyebrow block">
                Hidden tests ({DRAFT_TEST_PATH})
                <textarea className={`${FIELD} h-32 resize-y font-mono`} required spellCheck={false} value={custom.tests} onChange={(e) => editCustom({ tests: e.target.value })} />
              </label>
              {report && <CalibrationSummary report={report} />}
              <details>
                <summary className="eyebrow cursor-pointer">Patches to check the tests against (optional)</summary>
                <p className="m-0 mt-2 text-[11px] leading-[1.5] opacity-70">
                  Unified diffs against the commit above. The tests must pass with the reference fix and should fail with the naive patch. They are used for this check and not kept.
                </p>
                <label className="eyebrow mt-3 block">
                  Reference fix
                  <textarea className={`${FIELD} h-28 resize-y font-mono`} spellCheck={false} value={custom.referencePatch} onChange={(e) => editCustom({ referencePatch: e.target.value })} />
                </label>
                <label className="eyebrow mt-3 block">
                  Naive patch
                  <textarea className={`${FIELD} h-28 resize-y font-mono`} spellCheck={false} value={custom.naivePatch} onChange={(e) => editCustom({ naivePatch: e.target.value })} />
                </label>
              </details>
            </div>
          )}
        </Panel>
        <Panel title="Specialist" right="optional: leave empty for an open task">
          <ErrorNotice error={specialists.error} title="Could not load specialists" onRetry={() => void specialists.reload()} />
          {specialists.data?.length === 0 && <EmptyNote>No code-fix agents yet. Create one on the Provide page.</EmptyNote>}
          {specialists.data && specialists.data.length > 0 && <SpecialistPicker options={specialists.data} value={specialist} onChange={setSpecialist} />}
        </Panel>
      </div>
      <div className="flex flex-col gap-[18px]">
        <SpendBanner state={spend.data} />
        <Panel title="Terms">
          <div className="grid grid-cols-2 gap-5">
            <label className="eyebrow block">
              Bounty (tUSDC)
              <input className={FIELD} inputMode="decimal" required value={bounty} onChange={(e) => setBounty(e.target.value)} />
            </label>
            <label className="eyebrow block">
              Deadline (minutes)
              <input className={FIELD} type="number" min={5} max={1440} required value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>
          </div>
          <p className="m-0 mt-4 text-[11px] leading-[1.5] opacity-70">
            {advanced
              ? "The verifier checks your tests before funding, and they must fail on the unfixed code. They are committed by hash, hidden from the specialist, and published with the result once the task settles."
              : "The hidden tests are committed by hash before any work starts, and only the verifier sees them."}
          </p>
        </Panel>
        {blocked && (
          <div role="alert" className="border-l-[5px] border-bad bg-bad/10 px-4 py-3 leading-[1.5]">
            <p className="eyebrow m-0 mb-1 font-medium text-bad">Bounty blocked. Nothing was spent.</p>
            <p className="m-0 font-medium">{blocked}</p>
          </div>
        )}
        <ErrorNotice error={error} title="The task was not created" />
        <button type="submit" disabled={busy || drafting || (!advanced && !template)} className={PRIMARY_BUTTON}>
          {busy ? (advanced ? "CHECKING TESTS, THEN LOCKING…" : "LOCKING THE BOUNTY…") : "LOCK THE BOUNTY →"}
        </button>
      </div>
    </form>
  );
}

export function TaskNewView() {
  return (
    <>
      <PageHeading eyebrow="Tasks · post a task" title={<>Post a <em>task.</em></>}>
        Your agent locks the bounty in escrow within the limits you set.
      </PageHeading>
      <SignInGate next="/tasks/new" reason="Sign in to post a task. Each client is one verified person.">
        {() => <NewTaskForm />}
      </SignInGate>
    </>
  );
}
