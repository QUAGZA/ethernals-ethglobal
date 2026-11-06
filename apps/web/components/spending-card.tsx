"use client";

import { useCallback, useState, type FormEvent } from "react";
import type { SpendEventView } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { shortHex } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { Panel, Stat } from "./page-heading";
import { FIELD, SECONDARY_BUTTON, SpendEvents, PRIMARY_BUTTON } from "./task-bits";
import { useToast } from "./toast-provider";

const SETUP_GUIDE = "https://github.com/shravikamhatre/ethernals-ethglobal/blob/main/docs/proof-of-work/NAMERA-SETUP.md";

export function SpendingCard({ demoMode }: { demoMode: boolean }) {
  const toast = useToast();
  const loader = useCallback(() => api.spend(), []);
  const spend = useLoad(loader, "spend");
  const [form, setForm] = useState({ apiKey: "", walletId: "", sessionKeyId: "" });
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

  function connect(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.connectNamera(form);
      setForm({ apiKey: "", walletId: "", sessionKeyId: "" });
      toast("Namera connected.");
    });
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
          <form className="mt-4 flex flex-col gap-3" onSubmit={connect}>
            <label className="eyebrow block">
              API key
              <input className={FIELD} type="password" autoComplete="off" required value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </label>
            <label className="eyebrow block">
              Wallet id
              <input className={FIELD} autoComplete="off" required value={form.walletId} onChange={(e) => setForm({ ...form, walletId: e.target.value })} />
            </label>
            <label className="eyebrow block">
              Session key id
              <input className={FIELD} autoComplete="off" required value={form.sessionKeyId} onChange={(e) => setForm({ ...form, sessionKeyId: e.target.value })} />
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                CONNECT NAMERA →
              </button>
              <ExtLink href={SETUP_GUIDE}>Setup guide</ExtLink>
            </div>
          </form>
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
