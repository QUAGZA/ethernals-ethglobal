"use client";

import type { ReactNode } from "react";
import type { ArenaState } from "@ethernals/shared";
import { sepoliaAddressUrl } from "@ethernals/shared";
import { shortUsdc } from "@/lib/format";
import { ExtLink, TxLinkList } from "./ext-link";
import { FlashValue } from "./flash-value";

/** Optional extras a newer server may send; not in the shared ArenaState type yet. */
type OpenExtras = { fakeWallets?: number };
type EthernalsExtras = { farmSize?: number };

function ArenaPanel({
  title,
  status,
  children,
  footer,
}: {
  title: string;
  status: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <section className="flex flex-col border border-[#777]">
      <header className="flex items-center justify-between gap-4 border-b border-[#555] px-6 py-4 text-[15px] tracking-[.12em]">
        <h2 className="m-0 text-[15px] font-medium">{title}</h2>
        {status}
      </header>
      <div className="flex flex-1 flex-col px-6 pt-6 pb-5">{children}</div>
      <footer className="border-t border-[#555] px-6 py-5">{footer}</footer>
    </section>
  );
}

function RunningTag({ running }: { running: boolean }) {
  if (!running) return <span className="eyebrow opacity-60">IDLE</span>;
  return (
    <span className="eyebrow inline-flex items-center gap-2 text-yellow">
      <span className="inline-block size-[9px] animate-pulse-dot rounded-full bg-yellow" /> ATTACK RUNNING
    </span>
  );
}

function BigNumber({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <p className="eyebrow m-0 opacity-70">{label}</p>
      <div className="mt-2 flex items-baseline gap-3">
        <FlashValue value={value} className="font-serif text-[clamp(96px,11vw,200px)] leading-[.85] tracking-[-.03em]" />
        {suffix && <span className="font-serif text-[clamp(28px,3vw,48px)] opacity-60">{suffix}</span>}
      </div>
    </div>
  );
}

function PrepareHint({ handle }: { handle: string | null }) {
  return (
    <p className="m-0 border border-dashed border-[#777] px-4 py-4 text-[14px] leading-[1.6]">
      Run <code className="bg-paper/10 px-1.5 py-0.5 text-yellow">pnpm arena:prepare -- --attacker {handle ?? "<handle>"}</code> first.
    </p>
  );
}

const buttonClass =
  "w-full cursor-pointer border border-yellow bg-yellow px-5 py-5 text-[15px] tracking-[.08em] text-ink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40";

export function OpenRegistryPanel({
  state,
  starting,
  onRun,
}: {
  state: ArenaState["open"];
  starting: boolean;
  onRun: () => void;
}) {
  const wallets = (state as ArenaState["open"] & OpenExtras).fakeWallets;
  return (
    <ArenaPanel
      title="OPEN REGISTRY · ERC-8004 · SEPOLIA"
      status={<RunningTag running={state.running} />}
      footer={
        state.ready ? (
          <button className={buttonClass} disabled={state.running || starting} onClick={onRun}>
            {state.running || starting
              ? "FAKE REVIEWS IN FLIGHT…"
              : `RUN FAKE-REVIEW ATTACK${wallets ? ` (${wallets} WALLETS)` : ""}`}
          </button>
        ) : (
          <PrepareHint handle={null} />
        )
      }
    >
      <BigNumber label="Average rating · every review counts" value={state.average} suffix="/ 5" />
      <dl className="mt-8 grid grid-cols-2 gap-4 text-[18px]">
        <div>
          <dt className="eyebrow opacity-60">Reviewers</dt>
          <dd className="m-0 mt-1 text-[28px]">
            <FlashValue value={String(state.reviewers)} />
          </dd>
        </div>
        <div>
          <dt className="eyebrow opacity-60">Reviews</dt>
          <dd className="m-0 mt-1 text-[28px]">
            <FlashValue value={String(state.feedbackCount)} />
          </dd>
        </div>
      </dl>
      <p className="mt-6 mb-0 text-[20px] leading-[1.4]">
        ≈ <FlashValue value={`$${state.costUsd}`} tween={false} className="text-yellow" /> if done on Base mainnet
      </p>
      <p className="mt-1 mb-0 opacity-60">Gas used: {Number(state.gasUsed).toLocaleString()} · the standard has no way to tell a paid review from a fresh wallet.</p>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <ExtLink href={state.registry && /^0x[0-9a-fA-F]{40}$/.test(state.registry) ? sepoliaAddressUrl(state.registry) : null}>
            Reputation registry
          </ExtLink>
          <ExtLink href={state.agentUrl}>{state.agentId ? `Agent #${state.agentId} on the identity registry` : "Agent"}</ExtLink>
        </div>
        <TxLinkList urls={state.txUrls} label="Etherscan txs" />
      </div>
    </ArenaPanel>
  );
}

export function EthernalsPanel({
  state,
  starting,
  otherAttacker,
  onToggleOther,
  onRun,
}: {
  state: ArenaState["ethernals"];
  starting: boolean;
  otherAttacker: boolean;
  onToggleOther: (value: boolean) => void;
  onRun: () => void;
}) {
  const farmSize = (state as ArenaState["ethernals"] & EthernalsExtras).farmSize;
  const recorded = state.counted + state.notCounted;
  const votes = state.counted > 0 ? 1 : 0;
  const headline = state.attackerIsProvider
    ? `${state.hires} hires · ${state.paid} paid · ${state.counted} counted`
    : `${state.hires} hires · 1 person · ${votes} ${votes === 1 ? "vote" : "votes"}`;
  const busy = state.running || starting;

  return (
    <ArenaPanel
      title="ETHERNALS · HEDERA"
      status={<RunningTag running={state.running} />}
      footer={
        state.ready ? (
          <div className="flex flex-col gap-4">
            <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-[1.5]">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-yellow"
                checked={otherAttacker}
                disabled={busy}
                onChange={(e) => onToggleOther(e.target.checked)}
              />
              <span>
                Attacker is a different person
                <span className="block text-[12px] opacity-60">
                  {otherAttacker
                    ? "Expected: N hires · 1 person · 1 vote (each re-rating replaces the same vote)."
                    : "Expected: the provider's own agents hire it. N hires · N paid · 0 counted."}
                </span>
              </span>
            </label>
            <button className={buttonClass} disabled={busy} onClick={onRun}>
              {busy ? "FARMED HIRES IN FLIGHT…" : `RUN FARMED-HIRE ATTACK${farmSize ? ` (${farmSize} AGENTS)` : ""}`}
            </button>
          </div>
        ) : (
          <PrepareHint handle={state.attackerHandle} />
        )
      }
    >
      <BigNumber label={`Score · ${state.agentEnsName ?? "target agent"}`} value={state.score} suffix="/ 5" />
      <p className="mt-8 mb-0 text-[clamp(20px,2vw,30px)] leading-[1.25]">
        <FlashValue value={headline} tween={false} />
      </p>
      {!state.attackerIsProvider && state.counted > 0 && (
        <p className="mt-1 mb-0 opacity-70">
          {state.counted} counted hires, all from one person: {state.counted - 1} replaced the same vote.
        </p>
      )}
      <dl className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <dt className="eyebrow opacity-60">Attacker spent</dt>
          <dd className="m-0 mt-1 text-[24px]">
            <FlashValue value={shortUsdc(state.spentUsdc)} tween={false} /> <span className="text-[14px] opacity-70">USDC</span>
          </dd>
        </div>
        <div>
          <dt className="eyebrow opacity-60">Price</dt>
          <dd className="m-0 mt-1 text-[24px]">
            <FlashValue value={shortUsdc(state.price)} tween={false} /> <span className="text-[14px] opacity-70">USDC</span>
          </dd>
        </div>
      </dl>
      <p className="mt-4 mb-0 opacity-70">
        Attacker: {state.attackerHandle ? `@${state.attackerHandle}` : "—"}{" "}
        {state.attackerIsProvider ? "(the agent's own provider)" : "(a different verified person)"} · recorded on the ledger:{" "}
        {recorded}/{state.paid}
      </p>
      <div className="mt-auto pt-6">
        <TxLinkList urls={state.paymentUrls} label="HashScan payments" />
      </div>
    </ArenaPanel>
  );
}
