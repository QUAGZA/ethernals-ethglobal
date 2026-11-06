"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { EventType, TaskStatus } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError, type TaskDetail } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { dateTimeOf, shortHex, usdc2 } from "@/lib/format";
import { useDebounced, useElapsed, useInterval, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { PageHeading, Panel, Stat } from "./page-heading";
import { ReasonBadge } from "./reason-badge";
import { PRIMARY_BUTTON, PatchDiff, ReceiptTable, SECONDARY_BUTTON, SpendEvents, StatusChip, VerifierConsole, isFinished, useVerifyLog } from "./task-bits";
import { SpecialistPicker, useSpecialists } from "./task-new-view";
import { useToast } from "./toast-provider";

export const TASK_EVENTS: EventType[] = ["task.accepted", "task.submitted", "task.settled", "task.refunded", "verify.status", "verify.result", "inference.receipt", "hire.recorded", "info"];

const ORDER: TaskStatus[] = ["open", "accepted", "submitted", "verifying"];

function Timeline({ task }: { task: TaskDetail }) {
  const reached = (status: TaskStatus) => {
    const finished = task.status === "passed" || task.status === "failed" || task.status === "refunded";
    if (finished) return status !== "verifying" || Boolean(task.verifyJobId);
    return ORDER.indexOf(task.status) >= ORDER.indexOf(status);
  };
  const end = task.status === "failed" ? "Failed" : task.status === "refunded" ? "Refunded" : "Passed";
  const rows = [
    { label: "Created", done: Boolean(task.links.createTx), href: task.links.createTx },
    { label: "Accepted", done: reached("accepted") && Boolean(task.links.acceptTx), href: task.links.acceptTx },
    { label: "Submitted", done: reached("submitted") && Boolean(task.links.submitTx), href: task.links.submitTx },
    { label: "Verifying", done: Boolean(task.verifyJobId), href: task.links.erc8004Request },
    { label: end, done: task.status === "passed" || task.status === "failed" || task.status === "refunded", href: task.links.settleTx ?? task.links.refundTx },
  ];
  return (
    <ol className="m-0 grid list-none grid-cols-5 border p-0 max-md:grid-cols-1">
      {rows.map((row) => (
        <li key={row.label} className={`border-r px-4 py-3 last:border-r-0 max-md:border-r-0 max-md:border-b ${row.done ? "bg-cobalt text-ink" : "opacity-50"}`}>
          <p className="eyebrow m-0 font-medium">{row.label}</p>
          <ExtLink href={row.href} className="text-[11px]">
            Etherscan
          </ExtLink>
        </li>
      ))}
    </ol>
  );
}

function ResultCard({ task }: { task: TaskDetail }) {
  const { result, hire, scoreChange, links } = task;
  if (!result) return null;
  return (
    <Panel title="Result" right={<span className={result.passed ? "text-good" : "text-bad"}>{result.passed ? "PASSED" : "FAILED"}</span>}>
      <div className="grid grid-cols-4 gap-5 max-md:grid-cols-2">
        <Stat label="Tests passed" value={result.testsPassed} />
        <Stat label="Tests failed" value={result.testsFailed + result.testsErrored} />
        <Stat label="Isolation" value={result.isolation === "docker" ? "Docker" : <span className="text-bad">none (local)</span>} />
        <Stat label="Took" value={`${(result.durationMs / 1000).toFixed(1)} s`} />
      </div>
      {result.failureReason && <p className="m-0 mt-3 text-bad">{result.failureReason.replace(/_/g, " ")}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {hire?.reason && <ReasonBadge reason={hire.reason} />}
        {scoreChange?.after && (
          <span>
            Score {scoreChange.before ?? "?"} → <strong>{scoreChange.after}</strong>
          </span>
        )}
        <ExtLink href={links.result}>Signed result</ExtLink>
        <ExtLink href={links.erc8004Response}>Validation on ERC-8004</ExtLink>
        <ExtLink href={links.hireLedger}>HireLedger</ExtLink>
        <ExtLink href={links.x402Payment}>x402 payment</ExtLink>
      </div>
    </Panel>
  );
}

function Actions({ task, reload }: { task: TaskDetail; reload: () => void }) {
  const { me } = useApp();
  const toast = useToast();
  const specialists = useSpecialists();
  const [picked, setPicked] = useState(task.specialistEnsName ?? "");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const elapsed = useElapsed(startedAt);
  const mine = me?.person?.handle === task.clientHandle;
  if (!mine) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    setStartedAt(Date.now());
    setError(null);
    try {
      await action();
      toast(done);
      reload();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setStartedAt(null);
    }
  }

  const busy = startedAt !== null;
  const canHire = task.status === "open";
  if (!canHire && !task.refundable) {
    return task.refundableAt && !["passed", "failed", "refunded"].includes(task.status) ? (
      <p className="m-0 text-[11px] opacity-70">Refund opens {dateTimeOf(task.refundableAt)}.</p>
    ) : null;
  }

  return (
    <Panel title="Actions">
      {canHire && !task.specialistEnsName && specialists.data && <SpecialistPicker options={specialists.data} value={picked} onChange={setPicked} />}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canHire && (
          <button className={PRIMARY_BUTTON} disabled={busy || !picked} onClick={() => void run(() => api.hireForTask(task.id, picked), "Specialist hired.")}>
            {busy ? `HIRING… ${elapsed}s` : "HIRE OVER X402 →"}
          </button>
        )}
        {task.refundable && (
          <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => void run(() => api.refundTask(task.id), "Refund sent.")}>
            REFUND
          </button>
        )}
      </div>
      {canHire && busy && <p className="m-0 mt-3 text-[11px] opacity-70">The attempt fee is paid on Hedera, then the agent thinks on 0G. This can take a minute or two.</p>}
      <ErrorNotice className="mt-3" error={error} />
    </Panel>
  );
}

export function TaskDetailView({ id }: { id: string }) {
  const loader = useCallback(() => api.task(id), [id]);
  const task = useLoad(loader, `task:${id}`);
  const refresh = useDebounced(() => void task.reload(), 500);
  const log = useVerifyLog(id);
  useEvents((event) => {
    if (event.data.taskId === id || event.data.hireId === task.data?.hireId) refresh();
  }, TASK_EVENTS);
  useInterval(() => void task.reload(), 15_000);

  const data = task.data;
  if (!data) {
    return (
      <>
        <PageHeading eyebrow="Task" title="…" />
        <section className="px-[2.2vw] py-[3vw] max-md:px-5">
          {task.error ? <ErrorNotice error={task.error} title="Could not load this task" onRetry={() => void task.reload()} /> : <p className="eyebrow opacity-60">Loading task…</p>}
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeading
        eyebrow={`Task ${data.chainTaskId ? `#${data.chainTaskId}` : ""} · by @${data.clientHandle}`}
        title={data.spec.title}
        aside={
          <div className="flex flex-col items-end gap-2 max-md:items-start">
            <StatusChip status={data.status} />
            <span className="text-[14px]">{usdc2(data.bounty)} tUSDC</span>
          </div>
        }
      >
        <p className="m-0 whitespace-pre-wrap">{data.spec.issue}</p>
        <p className="m-0 mt-2 text-[12px] opacity-70">
          {data.specialistEnsName ? `Specialist ${data.specialistEnsName}` : "Open to any specialist"} · due {dateTimeOf(data.deadline)}
          {data.duelId && (
            <>
              {" · "}
              <Link className="border-b" href={`/duel?id=${data.duelId}`}>
                part of a duel
              </Link>
            </>
          )}
        </p>
      </PageHeading>

      <section className="flex flex-col gap-[18px] px-[2.2vw] py-[3vw] pb-[6vw] max-md:px-5 max-md:py-8">
        <Timeline task={data} />
        {data.error && <ErrorNotice error={{ message: data.error }} title="This task hit a problem" />}
        <Actions task={data} reload={() => void task.reload()} />
        <ResultCard task={data} />
        <div className="grid grid-cols-2 gap-[18px] max-md:grid-cols-1">
          <Panel title="Verifier console" bodyClassName="">
            <VerifierConsole lines={log.lines} status={log.status} finished={isFinished(data.status)} />
          </Panel>
          <Panel title="Thought on 0G">
            {data.inference.length === 0 ? <EmptyNote>No thoughts yet.</EmptyNote> : <ReceiptTable receipts={data.inference} />}
          </Panel>
        </div>
        <Panel title="The patch" right={data.patchHash ? shortHex(data.patchHash, 8) : undefined} bodyClassName={data.patch ? "" : "p-5"}>
          {data.patch ? <PatchDiff patch={data.patch} /> : <EmptyNote>No patch yet.</EmptyNote>}
          {data.explanation && <p className="m-0 border-t px-5 py-3 leading-[1.6]">{data.explanation}</p>}
        </Panel>
        <div className="grid grid-cols-2 gap-[18px] max-md:grid-cols-1">
          <Panel title="Commitments">
            <p className="m-0 leading-[1.6] break-all">Hidden tests committed before work: testsHash {data.testsHash ?? "—"}</p>
            <p className="m-0 mt-2 leading-[1.6] break-all">Public spec: specHash {data.specHash ?? "—"}</p>
          </Panel>
          <Panel title="Spending">{data.spend.length === 0 ? <EmptyNote>No spend attempts.</EmptyNote> : <SpendEvents events={data.spend} />}</Panel>
        </div>
      </section>
    </>
  );
}
