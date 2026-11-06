"use client";

import type { EventMessage } from "@ethernals/shared";
import { timeOf } from "@/lib/format";
import { eventString, useEventStatus } from "@/lib/use-events";
import { ExtLink, LedgerLink, PaymentLink } from "./ext-link";
import { ReasonBadge, StatusTag } from "./reason-badge";

const TYPE_LABELS: Record<string, string> = {
  "agent.created": "AGENT",
  "hire.delivered": "PAID",
  "hire.rated": "RATED",
  "hire.recorded": "LEDGER",
  "hire.payment_not_verified": "PAYMENT",
  "subhire.blocked": "SUB-HIRE",
  "egress.blocked": "EGRESS",
  "ens.updated": "ENS",
  "arena.open.feedback": "ERC-8004",
  "arena.open.done": "ERC-8004",
  "arena.ethernals.progress": "FARM",
  "arena.ethernals.done": "FARM",
  "task.created": "TASK",
  "task.accepted": "TASK",
  "task.submitted": "TASK",
  "task.settled": "SETTLED",
  "task.refunded": "REFUND",
  "verify.status": "VERIFIER",
  "verify.result": "VERIFIER",
  "agent.born": "SPIN-UP",
  "inference.receipt": "0G",
  "spend.allowed": "SPEND",
  "spend.blocked": "BLOCKED",
  info: "INFO",
};

function fallbackMessage(e: EventMessage): string {
  const agent = e.data.agentEnsName ?? "";
  return `${e.type}${agent ? ` · ${agent}` : ""}`;
}

export function EventStatusDot({ dark = false }: { dark?: boolean }) {
  const status = useEventStatus();
  const color = status === "live" ? "bg-good" : status === "idle" ? (dark ? "bg-paper/40" : "bg-ink/40") : "bg-warn";
  const label = status === "live" ? "LIVE" : status === "idle" ? "IDLE" : status === "connecting" ? "CONNECTING" : "RECONNECTING";
  return (
    <span className="eyebrow inline-flex items-center gap-2">
      <span className={`inline-block size-[8px] rounded-full ${color} ${status === "live" ? "animate-pulse-dot" : ""}`} />
      {label}
    </span>
  );
}

/** One row per event, newest first, with reason badges and explorer links. */
export function EventLog({
  events,
  dark = false,
  emptyText = "Waiting for events…",
  large = false,
}: {
  events: EventMessage[];
  dark?: boolean;
  emptyText?: string;
  large?: boolean;
}) {
  const line = dark ? "border-[#444]" : "border-line";
  if (events.length === 0) {
    return <p className={`m-0 px-5 py-6 opacity-60 ${large ? "text-[14px]" : ""}`}>{emptyText}</p>;
  }
  return (
    <ol className={`m-0 list-none p-0 ${large ? "text-[14px]" : ""}`}>
      {events.map((e) => {
        // spend.blocked and task.settled carry plain-language reasons, not reputation reason codes.
        const reason = typeof e.data.reason === "string" && e.type !== "spend.blocked" && e.type !== "task.settled" ? e.data.reason : null;
        const txUrl = eventString(e, "txUrl");
        const ensUrl = eventString(e, "ensUrl");
        return (
          <li
            key={`${e.id}-${e.at}`}
            className={`grid grid-cols-[86px_92px_1fr] items-baseline gap-x-4 gap-y-1 border-b px-5 py-2.5 max-md:grid-cols-[70px_1fr] ${line}`}
          >
            <span className="tabular-nums opacity-60">{timeOf(e.at)}</span>
            <span className="max-md:hidden">
              <StatusTag>{TYPE_LABELS[e.type] ?? e.type.toUpperCase()}</StatusTag>
            </span>
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {reason && <ReasonBadge reason={reason} />}
              {e.type === "hire.recorded" && e.data.counted === false && !reason && <StatusTag tone="warn">NOT COUNTED</StatusTag>}
              <span className="break-words">{e.data.message ?? fallbackMessage(e)}</span>
              <PaymentLink href={e.data.paymentUrl} />
              <LedgerLink href={e.data.ledgerUrl} />
              <ExtLink href={txUrl} arrow={false} className="text-[11px]">
                Tx ↗ Etherscan
              </ExtLink>
              <ExtLink href={ensUrl} className="text-[11px]">
                ENS tx
              </ExtLink>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
