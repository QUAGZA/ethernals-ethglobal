"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, toApiError, type ApiRequestError, type TaskDetail } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useDebounced, useElapsed, useInterval, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { PageHeading } from "./page-heading";
import { SignInGate } from "./sign-in-gate";
import { TASK_EVENTS } from "./task-detail-view";
import { FIELD, PRIMARY_BUTTON, StatusChip, VerifierConsole, isFinished, useVerifyLog } from "./task-bits";
import { useSpecialists } from "./task-new-view";

const DEFAULT_BOUNTY = "2.00";

function Outcome({ task }: { task: TaskDetail }) {
  if (task.status === "passed") return <p className="display-heading m-0 bg-yellow px-4 py-3 text-[clamp(48px,6vw,88px)] text-ink">PAID</p>;
  if (task.status === "failed" || task.status === "refunded") {
    return <p className="display-heading m-0 bg-[#333] px-4 py-3 text-[clamp(48px,6vw,88px)] text-paper">REFUNDED</p>;
  }
  return <StatusChip status={task.status} />;
}

function DuelColumn({ task }: { task: TaskDetail }) {
  const log = useVerifyLog(task.id);
  return (
    <section className="flex min-w-0 flex-col gap-4 border border-[#555] p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 font-serif text-[clamp(30px,3.4vw,52px)] font-normal break-all">{task.specialistEnsName?.split(".")[0] ?? "—"}</h2>
        <Link className="border-b text-[12px] whitespace-nowrap" href={`/tasks/${task.id}`}>
          Task →
        </Link>
      </div>
      <Outcome task={task} />
      {task.error && <ErrorNotice error={{ message: task.error }} />}
      {task.scoreChange?.after && (
        <p className="m-0 text-[20px]">
          Score {task.scoreChange.before ?? "?"} → <strong className="text-yellow">{task.scoreChange.after}</strong>
        </p>
      )}
      <VerifierConsole lines={log.lines} status={log.status} finished={isFinished(task.status)} tall />
      <div>
        <p className="eyebrow m-0 mb-1 opacity-60">0G request ids</p>
        {task.inference.length === 0 ? (
          <p className="m-0 opacity-60">None yet</p>
        ) : (
          task.inference.map((r) => (
            <p key={r.requestId} className="m-0 text-[13px] break-all">
              {r.requestId}
            </p>
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-[13px]">
        <ExtLink href={task.links.x402Payment}>x402 fee</ExtLink>
        <ExtLink href={task.links.settleTx}>Settlement</ExtLink>
        <ExtLink href={task.links.hireLedger}>HireLedger</ExtLink>
      </div>
    </section>
  );
}

function DuelBoard({ id }: { id: string }) {
  const loader = useCallback(() => api.duel(id), [id]);
  const duel = useLoad(loader, `duel:${id}`);
  const refresh = useDebounced(() => void duel.reload(), 500);
  useEvents((event) => {
    const ids = duel.data?.tasks.map((t) => t.id) ?? [];
    const hires = duel.data?.tasks.map((t) => t.hireId) ?? [];
    if (ids.includes(String(event.data.taskId)) || hires.includes(event.data.hireId ?? null)) refresh();
  }, TASK_EVENTS);
  useInterval(() => void duel.reload(), 10_000);

  return (
    <section className="bg-ink px-[2.2vw] py-[3vw] text-paper max-md:px-5 max-md:py-8">
      <ErrorNotice error={duel.error} title="Could not load this duel" onRetry={() => void duel.reload()} />
      {duel.data ? (
        <div className="grid grid-cols-2 gap-[18px] max-md:grid-cols-1">
          <DuelColumn task={duel.data.tasks[0]} />
          <DuelColumn task={duel.data.tasks[1]} />
        </div>
      ) : (
        !duel.error && <p className="eyebrow opacity-60">Loading the duel…</p>
      )}
    </section>
  );
}

function StartDuel({ onStarted }: { onStarted: (id: string) => void }) {
  const specialists = useSpecialists();
  const options = specialists.data ?? [];
  const [strong, setStrong] = useState("");
  const [weak, setWeak] = useState("");
  const [bounty, setBounty] = useState(DEFAULT_BOUNTY);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const elapsed = useElapsed(startedAt);

  useEffect(() => {
    if (options.length === 0) return;
    setStrong((current) => current || (options.find((o) => o.label === "fixer") ?? options[0]).ensName);
    setWeak((current) => current || (options.find((o) => o.label === "weak-fixer") ?? options[1] ?? options[0]).ensName);
  }, [options]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setStartedAt(Date.now());
    setError(null);
    try {
      onStarted((await api.createDuel({ template: "slugify", specialists: [strong, weak], bounty: bounty.trim() })).id);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setStartedAt(null);
    }
  }

  if (specialists.data && options.length < 2) {
    return (
      <div className="px-[2.2vw] py-[3vw] max-md:px-5">
        <EmptyNote>A duel needs two code-fix agents. Run the seed-coders script, or create them on the Provide page.</EmptyNote>
      </div>
    );
  }

  const busy = startedAt !== null;
  return (
    <form className="grid grid-cols-[1fr_1fr_160px_auto] items-end gap-5 px-[2.2vw] py-[3vw] max-md:grid-cols-1 max-md:px-5" onSubmit={start}>
      {(
        [
          ["Specialist one", strong, setStrong],
          ["Specialist two", weak, setWeak],
        ] as const
      ).map(([label, value, set]) => (
        <label key={label} className="eyebrow block">
          {label}
          <select className={`${FIELD} cursor-pointer`} value={value} disabled={busy} onChange={(e) => set(e.target.value)}>
            {options.map((o) => (
              <option key={o.ensName} value={o.ensName} disabled={o.status === "dormant"}>
                {o.label} · score {o.score}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="eyebrow block">
        Bounty (tUSDC)
        <input className={FIELD} inputMode="decimal" value={bounty} disabled={busy} onChange={(e) => setBounty(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || !strong || !weak || strong === weak} className={PRIMARY_BUTTON}>
        {busy ? `FUNDING… ${elapsed}s` : "START DUEL →"}
      </button>
      <div className="col-span-full empty:hidden">
        <ErrorNotice error={error} title="The duel did not start" />
      </div>
      <p className="col-span-full m-0 text-[11px] opacity-70 max-md:col-span-1">Template: Fix the slugify bug. Both agents get the same task and the same hidden tests.</p>
    </form>
  );
}

export function DuelView() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useApp();
  const id = params.get("id");

  return (
    <>
      <PageHeading eyebrow="Duel · same task, same hidden tests" title={<>Two agents. One <em>honest</em> result.</>}>
        The strong one passes and gets paid. The weak one fails and the client gets a refund. Each outcome is a vote on the HireLedger.
      </PageHeading>
      {id ? (
        <>
          <DuelBoard id={id} />
          {me?.person && (
            <p className="m-0 px-[2.2vw] py-5 max-md:px-5">
              <Link className="border-b" href="/duel">
                Start another duel →
              </Link>
            </p>
          )}
        </>
      ) : (
        <SignInGate next="/duel" reason="Sign in to start a duel. Your agent funds both bounties.">
          {() => <StartDuel onStarted={(duelId) => router.replace(`/duel?id=${duelId}`)} />}
        </SignInGate>
      )}
    </>
  );
}
