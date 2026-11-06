"use client";

import Link from "next/link";
import { useCallback } from "react";
import { sepoliaTxUrl } from "@ethernals/shared";
import { api } from "@/lib/api";
import { dateTimeOf, usdc2 } from "@/lib/format";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { PageHeading } from "./page-heading";
import { StatusChip } from "./task-bits";

export function TasksView() {
  const loader = useCallback(() => api.tasks(), []);
  const tasks = useLoad(loader, "tasks");
  const onChain = useLoad(useCallback(() => api.chainTasks(), []), "chain-tasks");
  const refresh = useDebounced(() => void tasks.reload(), 800);
  useEvents(refresh, ["task.created", "task.accepted", "task.submitted", "task.settled", "task.refunded", "verify.status"]);

  return (
    <>
      <PageHeading
        eyebrow="Tasks · proof-of-work hiring"
        title={<>Paid only if the <em>tests</em> pass.</>}
        aside={
          <Link href="/tasks/new" className="inline-block border border-ink bg-yellow px-5 py-[15px] whitespace-nowrap text-ink hover:bg-ink hover:text-yellow">
            POST A TASK →
          </Link>
        }
      >
        A client locks a bounty in escrow with hidden tests. A specialist writes a patch. A sandbox runs the tests: PASS pays the
        specialist, FAIL refunds the client.
      </PageHeading>
      <section className="px-[2.2vw] py-[3vw] max-md:px-5 max-md:py-8">
        <ErrorNotice error={tasks.error} title="Could not load tasks" onRetry={() => void tasks.reload()} className="mb-4" />
        {tasks.data === undefined ? (
          !tasks.error && <p className="eyebrow opacity-60">Loading tasks…</p>
        ) : tasks.data.length === 0 ? (
          <EmptyNote>No tasks yet. Post the first one.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="eyebrow border-b border-ink opacity-60">
                  <th className="py-2 pr-4 font-normal">TASK</th>
                  <th className="py-2 pr-4 font-normal">STATUS</th>
                  <th className="py-2 pr-4 font-normal">BOUNTY</th>
                  <th className="py-2 pr-4 font-normal">SPECIALIST</th>
                  <th className="py-2 font-normal">CREATED</th>
                </tr>
              </thead>
              <tbody>
                {tasks.data.map((task) => (
                  <tr key={task.id} className="border-b border-line hover:bg-white">
                    <td className="py-3 pr-4">
                      <Link className="font-serif text-[20px] hover:underline" href={`/tasks/${task.id}`}>
                        {task.spec.title}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusChip status={task.status} />
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{usdc2(task.bounty)} tUSDC</td>
                    <td className="py-3 pr-4">{task.specialistEnsName ?? <span className="opacity-50">open</span>}</td>
                    <td className="py-3 whitespace-nowrap opacity-70">{dateTimeOf(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {onChain.data && onChain.data.length > 0 && (
          <div className="mt-12">
            <p className="eyebrow mb-3 opacity-60">TASKS FOUND ON-CHAIN · read-only, from the TaskEscrow contract</p>
            <table className="w-full min-w-[560px] border-collapse text-left">
              <tbody>
                {onChain.data.map((t) => {
                  const last = t.txs.refunded ?? t.txs.settled ?? t.txs.submitted ?? t.txs.accepted ?? t.txs.created;
                  return (
                    <tr key={t.chainTaskId} className="border-b border-line">
                      <td className="py-3 pr-4">#{t.chainTaskId}</td>
                      <td className="py-3 pr-4">{t.status}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{t.bounty} tUSDC</td>
                      <td className="py-3">
                        {last && (
                          <a className="underline" href={sepoliaTxUrl(last)} target="_blank" rel="noreferrer">
                            Etherscan ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
