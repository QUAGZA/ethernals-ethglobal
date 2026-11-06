"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { HireView, MeResponse } from "@ethernals/shared";
import { ensAppUrl, hashscanAccountUrl } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { SIGNED_OUT, useApp } from "@/lib/app-context";
import { usdc2 } from "@/lib/format";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { ExtLink } from "./ext-link";
import { HireTable } from "./hire-table";
import { PageHeading, Panel, Stat } from "./page-heading";
import { SignInGate } from "./sign-in-gate";
import { SpendingCard } from "./spending-card";
import { useToast } from "./toast-provider";

/** A newer server may add the buyer's hires to GET /api/me; not in the shared type yet. */
type MeWithHires = MeResponse & { hires?: HireView[] };

/**
 * My hires: from /api/me if the server provides them, otherwise gathered from every
 * seller agent's recent hires where my buyer agent was the buyer.
 */
function useMyHires(me: MeWithHires) {
  const buyerName = me.buyerAgent?.ensName ?? null;
  const direct = me.hires;
  const loader = useCallback(async (): Promise<HireView[]> => {
    if (direct) return direct;
    const sellers = (await api.agents()).filter((a) => a.kind === "seller");
    const details = await Promise.all(sellers.map((a) => api.agent(a.label)));
    return details
      .flatMap((d) => d.hires)
      .filter((h) => h.buyerAgentEnsName === buyerName)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [direct, buyerName]);
  return useLoad(loader, buyerName ? `my-hires:${buyerName}:${direct ? direct.length : "scan"}` : null);
}

function PassControls({ me }: { me: MeResponse }) {
  const { setMe } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const expired = Boolean(me.person?.credentialExpired);

  async function run(kind: "expire" | "restore") {
    setBusy(true);
    setError(null);
    try {
      const next = kind === "expire" ? await api.expirePass() : await api.restorePass();
      setMe(next);
      toast(kind === "expire" ? "Your human pass is now expired." : "Your human pass is valid again.");
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Demo control · human pass" right={<span className="text-bad">DEMO_MODE</span>}>
      <p className="m-0 leading-[1.6]">
        Expire your own human credential to see the second denied path: your next hire still settles on Hedera, but
        is recorded as <strong>UNVERIFIED_BUYER</strong> and does not count.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="cursor-pointer border border-ink px-4 py-2.5 hover:bg-yellow disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || expired}
          onClick={() => void run("expire")}
        >
          EXPIRE MY PASS
        </button>
        <button
          className="cursor-pointer border border-ink px-4 py-2.5 hover:bg-yellow disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || !expired}
          onClick={() => void run("restore")}
        >
          RESTORE MY PASS
        </button>
      </div>
      <ErrorNotice className="mt-3" error={error} />
    </Panel>
  );
}

function MeDashboard({ me }: { me: MeWithHires }) {
  const router = useRouter();
  const { config, setMe, refreshMe } = useApp();
  const toast = useToast();
  const [logoutError, setLogoutError] = useState<ApiRequestError | null>(null);
  const hires = useMyHires(me);
  const person = me.person!;
  const buyer = me.buyerAgent;

  const refresh = useDebounced(() => {
    void refreshMe();
    void hires.reload();
  }, 1000);
  useEvents(
    (message) => {
      if (buyer && (message.data.buyerAgentEnsName === buyer.ensName || message.type === "hire.recorded")) refresh();
    },
    ["hire.delivered", "hire.recorded", "hire.payment_not_verified"],
  );

  async function logout() {
    setLogoutError(null);
    try {
      await api.logout();
      setMe(SIGNED_OUT);
      toast("Signed out.");
      router.push("/");
    } catch (err) {
      setLogoutError(toApiError(err));
    }
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-[18px] px-[2.2vw] py-[3vw] max-md:grid-cols-1 max-md:px-5 max-md:py-8">
        <Panel
          title="My person"
          right={
            <button className="cursor-pointer border-b" onClick={() => void logout()}>
              Log out
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Handle" value={`@${person.handle}`} />
            <Stat label="Mode" value={person.mode === "dev" ? <span className="text-bad">dev (not verified)</span> : person.mode} />
            <Stat label="Provider key" value={person.providerKeyShort} />
            <Stat
              label="Human pass"
              value={person.credentialExpired ? <span className="text-bad">expired</span> : <span className="text-good">valid</span>}
            />
          </div>
          <ErrorNotice className="mt-4" error={logoutError} title="Could not log out" />
        </Panel>

        <Panel title="My buyer agent" right={buyer ? <ExtLink href={ensAppUrl(buyer.ensName)}>ENS app</ExtLink> : null}>
          {buyer ? (
            <div className="grid grid-cols-2 gap-5">
              <Stat className="col-span-2" label="ENS name" value={<span className="font-serif text-[26px] font-normal">{buyer.ensName}</span>} />
              <Stat
                label="Hedera account"
                value={
                  <ExtLink href={hashscanAccountUrl(buyer.hederaAccountId, config?.hederaNetwork ?? "testnet")}>
                    {buyer.hederaAccountId}
                  </ExtLink>
                }
              />
              <Stat label="EVM address" value={<span className="text-[12px] break-all">{buyer.evmAddress}</span>} />
              <Stat label="USDC balance" value={`${usdc2(buyer.usdcBalance)} USDC`} />
              <Stat label="HBAR balance" value={`${buyer.hbarBalance} HBAR`} />
              <Stat label="Budget remaining" value={`${usdc2(buyer.budgetRemaining)} USDC`} />
            </div>
          ) : (
            <EmptyNote>No buyer agent yet. It is created when you sign up; if it is missing, ask the server operator to check the logs.</EmptyNote>
          )}
          {buyer && <FundBuyer accountId={buyer.hederaAccountId} tokenId={config?.usdcTokenId} />}
        </Panel>

        <SpendingCard demoMode={Boolean(config?.demoMode)} />

        {config?.demoMode && <PassControls me={me} />}
      </section>

      <section className="px-[2.2vw] pb-[6vw] max-md:px-5 max-md:pb-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="display-heading m-0 text-[clamp(40px,4.5vw,72px)]">
            My <em>hires</em>
          </h2>
          <span className="eyebrow opacity-60">paid by {buyer?.ensName ?? "my buyer agent"}</span>
        </div>
        <ErrorNotice error={hires.error} title="Could not load your hires" onRetry={() => void hires.reload()} className="mb-4" />
        {!buyer ? (
          <EmptyNote>No buyer agent, so no hires.</EmptyNote>
        ) : hires.data === undefined ? (
          !hires.error && <p className="eyebrow opacity-60">Loading your hires…</p>
        ) : hires.data.length === 0 ? (
          <EmptyNote>You have not hired any agent yet. Pick one on the agents page.</EmptyNote>
        ) : (
          <HireTable hires={hires.data} showAgent showBuyer={false} />
        )}
      </section>
    </>
  );
}

export function MeView() {
  const { me } = useApp();
  return (
    <>
      <PageHeading eyebrow="Me · person and buyer agent" title={me?.person ? <>@{me.person.handle}</> : <>Me</>} />
      <SignInGate next="/me" reason="Sign in to see your person, your buyer agent and your hires.">
        {(_person, current) => <MeDashboard me={current} />}
      </SignInGate>
    </>
  );
}

/** Pay from your own wallet: send USDC on Hedera testnet to the buyer agent, then let it spend that balance. */
function FundBuyer({ accountId, tokenId }: { accountId: string; tokenId?: string }) {
  const { setMe } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.syncBuyerBudget());
      toast("Budget set to your agent's full USDC balance.");
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t pt-5">
      <p className="eyebrow m-0 mb-2">Pay with your own wallet</p>
      <p className="m-0 text-[12px] leading-[1.6]">
        From any Hedera testnet wallet (HashPack, Blade…), send USDC{tokenId ? ` (token ${tokenId})` : ""} to{" "}
        <b className="break-all">{accountId}</b>. Your buyer agent already accepts it. Every hire is then paid from that
        balance over x402 on Hedera. Test USDC is free at faucet.circle.com (choose Hedera Testnet).
      </p>
      <div className="mt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void sync()}
          className="cursor-pointer border border-ink bg-yellow px-4 py-2 text-[12px] tracking-[.08em] text-ink hover:bg-ink hover:text-yellow disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "CHECKING…" : "I SENT USDC: USE MY FULL BALANCE"}
        </button>
      </div>
      <ErrorNotice className="mt-3" error={error} title="Could not update the budget" />
    </div>
  );
}
