"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ENS_DISPLAY_KEYS, ENS_KEYS, ensAppUrl } from "@ethernals/shared";
import { useApp } from "@/lib/app-context";
import { readEnsTextRecords, rpcHost, type EnsReadResult } from "@/lib/ens";
import { dateTimeOf, timeOf } from "@/lib/format";
import { useInterval } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { ExtLink } from "./ext-link";
import { FlashValue } from "./flash-value";

const REFRESH_MS = 15_000;
const KEYS = ENS_DISPLAY_KEYS.map((k) => k.key);

function display(key: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === ENS_KEYS.updated) return `${dateTimeOf(value)}`;
  return value;
}

/**
 * "Live from ENS (Sepolia)": the agent's text records, read in the browser with viem
 * (getEnsText via the Universal Resolver). Never from our API.
 */
export function EnsPanel({ ensName, ledgerScore }: { ensName: string; ledgerScore?: string }) {
  const { config, configError } = useApp();
  const [result, setResult] = useState<EnsReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedAt, setFailedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const nameRef = useRef(ensName);
  nameRef.current = ensName;

  const read = useCallback(async () => {
    if (!config || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const name = ensName;
    try {
      const next = await readEnsTextRecords(name, KEYS, config);
      if (nameRef.current !== name) return;
      setResult(next);
      setError(null);
      setFailedAt(null);
    } catch (err) {
      if (nameRef.current !== name) return;
      setError((err as Error).message);
      setFailedAt(new Date());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [config, ensName]);

  useEffect(() => {
    setResult(null);
    setError(null);
    void read();
  }, [read]);

  useInterval(() => void read(), config ? REFRESH_MS : null);

  // Re-read after this agent's records change; ENS writes land a few seconds after the event.
  useEvents(
    (message) => {
      if (message.data.agentEnsName !== ensName) return;
      void read();
      setTimeout(() => void read(), 6000);
    },
    ["ens.updated", "hire.recorded"],
  );

  const ensScore = result?.values[ENS_KEYS.score] ?? null;
  const lagging = Boolean(ensScore && ledgerScore && ensScore !== ledgerScore);

  return (
    <section className="flex flex-col border">
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3.5">
        <span className="eyebrow font-medium">Live from ENS (Sepolia)</span>
        <ExtLink href={ensAppUrl(ensName)} className="text-[11px]">
          Official ENS app
        </ExtLink>
      </header>

      {!config ? (
        <p className="m-0 px-5 py-4 text-bad">
          {configError ? `Cannot read ENS yet: ${configError.message} ${configError.hint ?? ""}` : "Loading the Sepolia RPC from the server config…"}
        </p>
      ) : (
        <>
          {error && (
            <div role="alert" className="border-b border-bad bg-bad/10 px-5 py-3 leading-[1.5]">
              <p className="m-0 font-medium text-bad">ENS is unreachable right now.</p>
              <p className="m-0 mt-1">
                {error} (RPC: {rpcHost(config.sepoliaRpcUrl)}, at {timeOf(failedAt)}).{" "}
                {result ? `The values below were read at ${timeOf(result.readAt)} and may be out of date.` : "No ENS values to show."}
              </p>
            </div>
          )}
          <dl className={`m-0 divide-y divide-line ${error && result ? "opacity-50" : ""}`}>
            {ENS_DISPLAY_KEYS.map(({ key, label }) => {
              const failed = result?.failedKeys.includes(key);
              const value = result ? (failed ? "read failed" : display(key, result.values[key])) : loading ? "…" : "—";
              const big = key === ENS_KEYS.score || key === ENS_KEYS.price;
              return (
                <div key={key} className="grid grid-cols-[minmax(130px,38%)_1fr] items-baseline gap-4 px-5 py-2.5">
                  <dt>
                    <span className="block">{label}</span>
                    <code className="text-[10px] opacity-50">{key}</code>
                  </dt>
                  <dd className={`m-0 break-all ${big ? "font-serif text-[28px] leading-none" : ""} ${failed ? "text-bad" : ""}`}>
                    <FlashValue value={value} tween={false} />
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="m-0 mt-auto border-t px-5 py-3 text-[11px] leading-[1.5] opacity-70">
            Read in your browser with viem from {rpcHost(config.sepoliaRpcUrl)}
            {result ? ` at ${timeOf(result.readAt)}` : ""} · refreshes every 15 s.
            {lagging && " The ledger already shows a newer score; the ENS write is on its way."}
            {result?.error && !error && ` Some records failed to read: ${result.error}`}
          </p>
        </>
      )}
    </section>
  );
}
