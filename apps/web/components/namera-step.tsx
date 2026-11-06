"use client";

import { useCallback, useState } from "react";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { FIELD, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./task-bits";
import { useToast } from "./toast-provider";

const DASHBOARD = "https://dashboard.namera.ai";
const EMPTY = { apiKey: "", walletId: "", sessionKeyId: "" };

/** Paste the three values from the Namera dashboard. The API key goes to our server only, and is stored encrypted. */
export function NameraForm({ onConnected, className = "" }: { onConnected: () => void; className?: string }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api.connectNamera(form);
      setForm(EMPTY);
      toast("Namera connected.");
      onConnected();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <ol className="m-0 list-decimal pl-4 text-[12px] leading-[1.6]">
        <li>
          In <ExtLink href={DASHBOARD}>dashboard.namera.ai</ExtLink>, create an account and a session key for Ethereum Sepolia, with a limit and an expiry.
        </li>
        <li>Approve the session key&apos;s installation, then create an API key.</li>
        <li>Paste the three values here.</li>
      </ol>
      <label className="eyebrow block">
        API key
        <input className={FIELD} type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
      </label>
      <label className="eyebrow block">
        Wallet id
        <input className={FIELD} autoComplete="off" value={form.walletId} onChange={(e) => setForm({ ...form, walletId: e.target.value })} />
      </label>
      <label className="eyebrow block">
        Session key id
        <input className={FIELD} autoComplete="off" value={form.sessionKeyId} onChange={(e) => setForm({ ...form, sessionKeyId: e.target.value })} />
      </label>
      <div>
        <button type="button" disabled={busy || !form.apiKey.trim() || !form.walletId.trim() || !form.sessionKeyId.trim()} className={PRIMARY_BUTTON} onClick={() => void connect()}>
          {busy ? "CONNECTING…" : "CONNECT NAMERA →"}
        </button>
      </div>
      <ErrorNotice error={error} title="Namera wasn't connected" />
    </div>
  );
}

/** The spending-limit step in the hire flow: shows the connected session key, or lets the person connect one. */
export function NameraStep({ serverLimit, note }: { serverLimit: string; note: string }) {
  const loader = useCallback(() => api.spend(), []);
  const spend = useLoad(loader, "namera-step");
  const [open, setOpen] = useState(false);
  const state = spend.data;
  const policy = state?.policy;

  if (!state) return <p className="m-0 text-[12px] opacity-60">{spend.error ? "Couldn't read your spending limits." : "Checking your spending limits…"}</p>;

  if (state.guard === "namera") {
    return (
      <div className="flex flex-col gap-2 border-l-[5px] border-good bg-good/10 px-4 py-3 text-[12px] leading-[1.5]">
        <span>
          <span className="text-good">Namera session key</span> · {policy?.status ?? "unknown"} · {policy?.tokenAllowanceUsdc ? `cap ${policy.tokenAllowanceUsdc} tUSDC` : "no token cap"}
          {policy?.validUntil ? ` · until ${new Date(policy.validUntil).toLocaleString()}` : ""}
        </span>
        <span className="opacity-70">{note}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-l-[5px] border-warn bg-warn/10 px-4 py-3 text-[12px] leading-[1.5]">
      <span>
        <span className="text-warn">Not connected.</span> Using server limits: up to {serverLimit}.
      </span>
      <span className="opacity-70">{note}</span>
      {open ? (
        <NameraForm onConnected={() => void spend.reload()} />
      ) : (
        <div>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setOpen(true)}>
            CONFIGURE NAMERA →
          </button>
        </div>
      )}
    </div>
  );
}
