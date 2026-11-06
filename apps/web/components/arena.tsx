"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/hooks";

function Side({
  eyebrow,
  title,
  value,
  caption,
  className,
}: {
  eyebrow: string;
  title: string;
  value: string;
  caption: string;
  className: string;
}) {
  return (
    <div className={`grid place-items-center border-[#555] p-[45px] text-center max-md:border-0 ${className}`}>
      <p className="m-0.5 text-[9px] tracking-[.14em]">{eyebrow}</p>
      <h3 className="m-1 font-serif text-[34px] font-normal">{title}</h3>
      <strong className="my-4 font-serif text-[clamp(80px,9vw,130px)] leading-none font-normal">{value}</strong>
      <p className="m-0.5 max-w-[320px] leading-[1.6] opacity-75">{caption}</p>
    </div>
  );
}

/** Landing-page teaser for /arena with the current live numbers. */
export function Arena() {
  const arena = useLoad(api.arenaState, "arena-teaser");
  const open = arena.data?.open;
  const eth = arena.data?.ethernals;

  return (
    <section
      className="bg-ink px-[2.2vw] py-[8vw] text-paper max-md:px-5 max-md:py-[70px]"
      id="arena"
    >
      <div className="grid grid-cols-[1fr_3fr_1.2fr] items-end max-md:block">
        <span className="eyebrow">03 / LIVE</span>
        <h2 className="display-heading text-[clamp(70px,9vw,130px)] max-md:my-[35px]">
          PROVE IT IN
          <br />
          THE <em>ARENA.</em>
        </h2>
        <p className="leading-[1.6]">
          The same attack, run live against two registries. Fresh wallets lift an
          agent&apos;s open ERC-8004 average for cents. Farmed hires against an
          Ethernals agent all settle on Hedera and are counted zero times.
        </p>
      </div>

      <div className="mt-[6vw] border border-[#777]">
        <div className="flex items-center justify-between border-b border-[#555] px-5 py-4">
          <span>FAKE REVIEWS VS. FARMED HIRES</span>
          <span className="before:mr-[7px] before:inline-block before:size-[7px] before:rounded-full before:bg-yellow before:content-['']">
            {arena.error ? "OFFLINE" : "LIVE NUMBERS"}
          </span>
        </div>

        <div className="grid min-h-[380px] grid-cols-[1fr_120px_1fr] max-md:grid-cols-1">
          <Side
            className="border-r"
            eyebrow="OPEN REGISTRY · ERC-8004 · SEPOLIA"
            title="Average rating"
            value={open?.average ?? "—"}
            caption={
              open
                ? `${open.reviewers} reviewers · ${open.feedbackCount} reviews · ≈ $${open.costUsd} if done on Base mainnet`
                : "Anyone with a fresh wallet can leave a 5★ review."
            }
          />
          <div className="grid place-items-center content-center gap-[35px] max-md:border-y max-md:p-[25px]">
            <span className="font-serif text-[42px] italic">VS</span>
          </div>
          <Side
            className="border-l"
            eyebrow="ETHERNALS · HEDERA"
            title={eth?.agentEnsName ?? "Score"}
            value={eth?.score ?? "—"}
            caption={
              eth
                ? `${eth.hires} farmed hires · ${eth.paid} paid · ${eth.counted} counted`
                : "Only a paid hire from a different verified person moves it."
            }
          />
        </div>

        {arena.error && (
          <p className="m-0 border-t border-[#555] px-5 py-3 text-[11px] opacity-80">
            Live numbers unavailable: {arena.error.message} {arena.error.hint}
          </p>
        )}
      </div>

      <div className="mt-[18px] flex items-center justify-between gap-6 bg-yellow p-[25px] text-ink max-md:flex-col max-md:items-start">
        <p className="m-0">TWENTY BOTS CAN&apos;T MOVE THE SCORE. ONE REAL, DIFFERENT PERSON CAN.</p>
        <Link className="border px-5 py-[15px] whitespace-nowrap hover:bg-ink hover:text-yellow" href="/arena">
          ENTER THE ARENA <span>→</span>
        </Link>
      </div>
    </section>
  );
}
