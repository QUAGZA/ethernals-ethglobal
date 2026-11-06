"use client";

/** Small pieces shared by the task, duel and agent pages. */
import { useEffect, useRef, useState } from "react";
import type { InferenceReceipt, SpendEventView, SpendStateView, TaskStatus } from "@ethernals/shared";
import Link from "next/link";
import { neuronTo0g, shortHex, timeOf } from "@/lib/format";
import { useEvents } from "@/lib/use-events";
import { ExtLink } from "./ext-link";

export const PRIMARY_BUTTON =
  "cursor-pointer border border-ink bg-yellow px-5 py-[15px] text-[13px] tracking-[.08em] text-ink hover:bg-ink hover:text-yellow disabled:cursor-not-allowed disabled:opacity-40";
export const SECONDARY_BUTTON = "cursor-pointer border border-ink px-4 py-2.5 hover:bg-yellow disabled:cursor-not-allowed disabled:opacity-40";
export const FIELD = "mt-1 block w-full border-b border-ink bg-transparent py-3 text-[13px] normal-case tracking-normal outline-none focus:bg-white/60";

const STATUS_STYLES: Record<TaskStatus, string> = {
  creating: "border-current opacity-60",
  open: "border-ink bg-yellow text-ink",
  accepted: "border-ink bg-yellow text-ink",
  submitted: "border-warn text-warn",
  verifying: "border-warn text-warn",
  passed: "border-good bg-good text-white",
  failed: "border-bad bg-bad text-white",
  refunded: "border-[#777] bg-[#777] text-white",
  error: "border-bad text-bad",
};

export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`eyebrow inline-block border px-2 py-1 ${STATUS_STYLES[status]}`}>{status}</span>;
}

/** A unified diff: added lines green, removed lines red. */
export function PatchDiff({ patch }: { patch: string }) {
  return (
    <pre className="m-0 max-h-[420px] overflow-auto bg-ink p-4 text-[12px] leading-[1.6] text-paper">
      {patch.split("\n").map((line, index) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        return (
          <span key={index} className={`block ${added ? "text-[#6ee7a0]" : removed ? "text-[#ff8a8a]" : line.startsWith("@@") ? "text-yellow" : ""}`}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

export function ReceiptTable({ receipts, showPurpose = false }: { receipts: InferenceReceipt[]; showPurpose?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="eyebrow border-b opacity-60">
            {showPurpose && <th className="py-2 pr-3 font-normal">PURPOSE</th>}
            <th className="py-2 pr-3 font-normal">MODEL</th>
            <th className="py-2 pr-3 font-normal">REQUEST ID</th>
            <th className="py-2 pr-3 font-normal">TOKENS</th>
            <th className="py-2 font-normal">COST (0G)</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.requestId} className="border-b border-line">
              {showPurpose && <td className="py-2 pr-3">{r.purpose}</td>}
              <td className="py-2 pr-3">{r.model}</td>
              <td className="py-2 pr-3 break-all" title={r.requestId}>
                {r.requestId}
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {r.promptTokens} / {r.completionTokens}
              </td>
              <td className="py-2 tabular-nums">{neuronTo0g(r.costNeuron)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live verifier output for one task, from the shared event stream. */
export function useVerifyLog(taskId: string | null | undefined): { lines: string[]; status: string | null } {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  useEvents(
    (event) => {
      if (!taskId || event.data.taskId !== taskId) return;
      if (event.type === "verify.log" && typeof event.data.line === "string") {
        const line = event.data.line;
        setLines((current) => [...current.slice(-400), line]);
      } else if (event.data.message) {
        setStatus(event.data.message);
      }
    },
    ["verify.log", "verify.status", "verify.result"],
  );
  return { lines, status };
}

export function VerifierConsole({ lines, status, tall = false }: { lines: string[]; status: string | null; tall?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length]);
  return (
    <div className={`overflow-auto bg-ink p-4 text-[12px] leading-[1.6] text-paper ${tall ? "h-[340px] text-[14px]" : "h-[240px]"}`} role="log" aria-live="polite">
      {lines.length === 0 && <p className="m-0 opacity-60">{status ?? "Waiting for the verifier…"}</p>}
      {lines.map((line, index) => (
        <div key={index} className="break-all whitespace-pre-wrap">
          {line}
        </div>
      ))}
      {lines.length > 0 && status && <p className="m-0 mt-2 text-yellow">{status}</p>}
      <div ref={end} />
    </div>
  );
}

export function guardLabel(state: SpendStateView | undefined): string {
  if (!state) return "Checking your spending controls…";
  const policy = state.policy;
  if (state.guard === "namera") {
    const cap = policy?.tokenAllowanceUsdc ? `cap ${policy.tokenAllowanceUsdc} tUSDC` : "no token cap";
    const expires = policy?.validUntil ? ` · expires ${new Date(policy.validUntil).toLocaleString()}` : "";
    return `Namera session key · ${cap}${expires}`;
  }
  return `Server-enforced · weaker · cap ${policy?.tokenAllowanceUsdc ?? "?"} tUSDC`;
}

export function SpendBanner({ state }: { state: SpendStateView | undefined }) {
  return (
    <div className={`flex items-center justify-between gap-4 border-l-[5px] px-4 py-3 ${state?.guard === "namera" ? "border-good bg-good/10" : "border-warn bg-warn/10"}`}>
      <span>{guardLabel(state)}</span>
      <Link className="border-b whitespace-nowrap" href="/me">
        Spending controls →
      </Link>
    </div>
  );
}

const SPEND_TONES = { confirmed: "text-good", blocked: "text-bad", failed: "text-warn" };

export function SpendEvents({ events }: { events: SpendEventView[] }) {
  return (
    <ul className="m-0 list-none p-0">
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="flex flex-wrap items-baseline gap-x-3 border-b border-line py-2">
          <span className="tabular-nums opacity-60">{timeOf(event.at)}</span>
          <span className={`eyebrow font-medium ${SPEND_TONES[event.status]}`}>{event.status === "confirmed" ? "allowed" : event.status}</span>
          <span>{event.amountUsdc} tUSDC</span>
          <span className="opacity-70">{event.purpose}</span>
          {event.reason && <span className="w-full text-[11px] text-bad">{event.rule ? `${event.rule}: ` : ""}{event.reason}</span>}
          <ExtLink href={event.txUrl} className="text-[11px]">
            Etherscan
          </ExtLink>
        </li>
      ))}
    </ul>
  );
}

export const shortId = (id: string | null | undefined) => shortHex(id, 8);
