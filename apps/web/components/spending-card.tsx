"use client";

import { useCallback, useState } from "react";
import type { SpendEventView } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { shortHex } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { ErrorNotice } from "./error-notice";
import { NameraForm } from "./namera-step";
import { Panel, Stat } from "./page-heading";
import { SECONDARY_BUTTON, SpendEvents } from "./task-bits";

export function SpendingCard({ demoMode }: { demoMode: boolean }) {
  const loader = useCallback(() => api.spend(), []);
  const spend = useLoad(loader, "spend");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [probe, setProbe] = useState<SpendEventView | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await spend.reload();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  const state = spend.data;
  const policy = state?.policy;
  const connected = state?.guard === "namera";

  return (
    <Panel title="Spending controls" right={state && (connected ? <span className="text-good">Namera session key</span> : <span className="text-warn">server-enforced, weaker</span>)}>
      <ErrorNotice error={spend.error} title="Could not load your spending controls" onRetry={() => void spend.reload()} />
      {connected && policy && (
        <div className="grid grid-cols-2 gap-5">
          <Stat className="col-span-2" label="Account" value={<span className="text-[12px] break-all">{policy.accountAddress}</span>} />
          <Stat label="Token cap" value={policy.tokenAllowanceUsdc ? `${policy.tokenAllowanceUsdc} tUSDC` : "None"} />
          <Stat label="Rate limit" value={policy.rateLimit ?? "None"} />
          <Stat label="Expires" value={policy.validUntil ? new Date(policy.validUntil).toLocaleString() : "Never"} />
          <Stat label="Status" value={policy.status} />
          <Stat className="col-span-2" label="Allowed contracts" value={<span className="text-[12px]">{policy.allowedContracts.map((c) => shortHex(c)).join(" · ") || "—"}</span>} />
        </div>
      )}
      {state && !connected && (
        <>
          <p className="m-0 leading-[1.6]">
            Your agent funds bounties with its own key, and only this server checks its limits. Connect Namera and a session key with an on-chain
            policy decides what it may spend instead.
          </p>
          <NameraForm className="mt-4" onConnected={() => void spend.reload()} />
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        {connected && (
          <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => void run(() => api.disconnectNamera())}>
            DISCONNECT
          </button>
        )}
        {demoMode && state && (
          <button className={SECONDARY_BUTTON} disabled={busy} onClick={() => void run(async () => setProbe((await api.tryOverspend()).event))}>
            TRY AN OVERSPEND
          </button>
        )}
      </div>
      <ErrorNotice className="mt-3" error={error} />
      {probe && (
        <div role="status" className={`mt-3 border-l-[5px] px-4 py-3 ${probe.status === "blocked" ? "border-bad bg-bad/10" : "border-warn bg-warn/10"}`}>
          <p className="m-0 font-medium">
            {probe.status === "blocked" ? "BLOCKED" : probe.status.toUpperCase()}: {probe.amountUsdc} tUSDC
          </p>
          {probe.reason && <p className="m-0 mt-1">{probe.rule ? `${probe.rule} — ` : ""}{probe.reason}</p>}
        </div>
      )}
      {(state?.recent.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="eyebrow m-0 mb-1 opacity-60">Recent spends</p>
          <SpendEvents events={state!.recent} />
        </div>
      )}
    </Panel>
  );
}
