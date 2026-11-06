"use client";

import { useCallback, useState } from "react";
import { useEvents } from "@/lib/use-events";

export interface SpinUpStep {
  step: string;
  message: string;
}

/** Collects the live agent.born steps for one agent. Pass null while nothing is being created. */
export function useSpinUp(ensName: string | null) {
  const [steps, setSteps] = useState<SpinUpStep[]>([]);
  useEvents(
    (event) => {
      if (!ensName || event.data.agentEnsName !== ensName) return;
      const step = typeof event.data.step === "string" ? event.data.step : "";
      setSteps((current) => [...current.filter((s) => s.step !== step), { step, message: event.data.message ?? step }]);
    },
    ["agent.born"],
  );
  const reset = useCallback(() => setSteps([]), []);
  return { steps, reset };
}

const ROWS: { step: string; label: string; codeFixOnly?: boolean }[] = [
  { step: "hedera", label: "Hedera account" },
  { step: "ledger", label: "HireLedger" },
  { step: "brain-key", label: "0G brain key" },
  { step: "first-thought", label: "First thought" },
  { step: "gas", label: "Sepolia gas", codeFixOnly: true },
  { step: "erc8004", label: "ERC-8004", codeFixOnly: true },
  { step: "ens", label: "ENS" },
];

export function SpinUpChecklist({ steps, codeFix }: { steps: SpinUpStep[]; codeFix: boolean }) {
  return (
    <ol className="m-0 list-none border p-0" aria-label="Spin-up steps">
      {ROWS.filter((row) => codeFix || !row.codeFixOnly).map((row) => {
        const found = steps.find((s) => s.step === row.step);
        const failed = found?.message.includes("✖");
        return (
          <li key={row.step} className="grid grid-cols-[22px_130px_1fr] items-baseline gap-2 border-b border-line px-3 py-2 last:border-b-0 max-md:grid-cols-[22px_1fr]">
            <span className={failed ? "text-bad" : found ? "text-good" : "opacity-30"}>{failed ? "✖" : found ? "✓" : "○"}</span>
            <span className="font-medium">{row.label}</span>
            <span className="text-[11px] break-all opacity-70 max-md:col-span-2">{found?.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
