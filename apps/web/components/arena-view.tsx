"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArenaState, EventMessage, EventType } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { labelOf } from "@/lib/format";
import { useDebounced, useInterval } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EthernalsPanel, OpenRegistryPanel } from "./arena-panels";
import { ErrorNotice } from "./error-notice";
import { EventLog, EventStatusDot } from "./event-log";

const ARENA_EVENTS: EventType[] = [
  "arena.open.feedback",
  "arena.open.done",
  "arena.ethernals.progress",
  "arena.ethernals.done",
  "hire.recorded",
];
const FAST_POLL_MS = 1500;
const IDLE_POLL_MS = 10_000;
/** After a run ends, keep polling fast while paid hires are still being recorded. */
const SETTLE_MS = 120_000;
const MAX_LOG = 150;

export function ArenaView() {
  const { config } = useApp();
  const [state, setState] = useState<ArenaState | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [actionError, setActionError] = useState<ApiRequestError | null>(null);
  const [starting, setStarting] = useState<{ open: boolean; ethernals: boolean }>({ open: false, ethernals: false });
  const [otherAttacker, setOtherAttacker] = useState(false);
  const [events, setEvents] = useState<EventMessage[]>([]);
  const [watchUntil, setWatchUntil] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api.arenaState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = Boolean(state && (state.open.running || state.ethernals.running));
  const unrecorded = Boolean(state && state.ethernals.paid > state.ethernals.counted + state.ethernals.notCounted);
  const watching = Date.now() < watchUntil;
  const fast = running || starting.open || starting.ethernals || (watching && unrecorded) || (watching && !state);
  useInterval(() => void refresh(), fast ? FAST_POLL_MS : IDLE_POLL_MS);

  // While running, keep extending the settle window.
  useEffect(() => {
    if (running) setWatchUntil(Date.now() + SETTLE_MS);
  }, [running, state]);

  const refreshSoon = useDebounced(() => void refresh(), 300);
  useEvents((message) => {
    setEvents((list) => [message, ...list].slice(0, MAX_LOG));
    if (ARENA_EVENTS.includes(message.type)) {
      setWatchUntil(Date.now() + SETTLE_MS);
      refreshSoon();
    }
  });

  async function runOpen() {
    setActionError(null);
    setStarting((s) => ({ ...s, open: true }));
    setWatchUntil(Date.now() + SETTLE_MS);
    try {
      setState(await api.runOpenAttack());
    } catch (err) {
      setActionError(toApiError(err));
    } finally {
      setStarting((s) => ({ ...s, open: false }));
    }
  }

  async function runEthernals() {
    setActionError(null);
    setStarting((s) => ({ ...s, ethernals: true }));
    setWatchUntil(Date.now() + SETTLE_MS);
    try {
      setState(await api.runEthernalsAttack({ attacker: otherAttacker ? "other" : "provider" }));
    } catch (err) {
      setActionError(toApiError(err));
    } finally {
      setStarting((s) => ({ ...s, ethernals: false }));
    }
  }

  const targetName = state?.ethernals.agentEnsName ?? null;
  const targetLabel = targetName ? labelOf(targetName, config?.ensParent) : null;

  return (
    <section className="min-h-[calc(100vh-76px)] bg-ink px-[2.2vw] pt-[2.5vw] pb-[4vw] text-paper max-md:px-5 max-md:pt-8">
      <div className="flex items-end justify-between gap-8 max-md:block">
        <div>
          <p className="eyebrow m-0 text-[12px]">The Arena · the same attack against two registries</p>
          <h1 className="display-heading mt-5 mb-0 text-[clamp(52px,6.5vw,104px)]">
            Fake reviews are cheap. <em>Fake people</em> don&apos;t count.
          </h1>
        </div>
        <div className="shrink-0 pb-2 max-md:mt-6">
          <EventStatusDot dark />
        </div>
      </div>

      <div className="mt-[2.5vw] flex flex-col gap-3 max-md:mt-8">
        <ErrorNotice error={error} title="Could not load the Arena" onRetry={() => void refresh()} className="text-paper" />
        <ErrorNotice error={actionError} title="The attack did not start" className="text-paper" />
      </div>

      {state ? (
        <div className="mt-[1.5vw] grid grid-cols-2 gap-[18px] max-md:mt-6 max-md:grid-cols-1">
          <OpenRegistryPanel state={state.open} starting={starting.open} onRun={() => void runOpen()} />
          <EthernalsPanel
            state={state.ethernals}
            starting={starting.ethernals}
            otherAttacker={otherAttacker}
            onToggleOther={setOtherAttacker}
            onRun={() => void runEthernals()}
          />
        </div>
      ) : (
        !error && <p className="mt-10 text-[16px] opacity-60">Loading the Arena…</p>
      )}

      <section className="mt-[18px] border border-[#777]">
        <header className="flex items-center justify-between border-b border-[#555] px-5 py-4 text-[14px] tracking-[.12em]">
          <h2 className="m-0 text-[14px] font-medium">LIVE EVENT LOG</h2>
          <span className="eyebrow flex flex-wrap items-center justify-end gap-3 opacity-80">
            <span className="text-good">■ counted</span>
            <span className="text-warn">■ same person / unverified</span>
            <span className="text-bad">■ blocked / payment not verified</span>
          </span>
        </header>
        <div className="max-h-[420px] overflow-y-auto">
          <EventLog events={events} dark large emptyText="Waiting for the first event. Run an attack above." />
        </div>
      </section>

      <div className="mt-[18px] flex items-center justify-between gap-6 bg-yellow p-[25px] text-ink max-md:flex-col max-md:items-start">
        <p className="m-0 text-[15px]">TWENTY BOTS CAN&apos;T MOVE THE SCORE. ONE REAL, DIFFERENT PERSON CAN.</p>
        {targetLabel ? (
          <Link
            href={`/agents/${targetLabel}`}
            className="border border-ink px-6 py-4 text-[16px] whitespace-nowrap hover:bg-ink hover:text-yellow"
          >
            Now a real, different person hires →
          </Link>
        ) : (
          <span className="border border-ink/40 px-6 py-4 text-[16px] opacity-50">Now a real, different person hires →</span>
        )}
      </div>
    </section>
  );
}
