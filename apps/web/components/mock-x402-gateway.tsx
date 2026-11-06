"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { shortUsdc } from "@/lib/format";
import type { MockAgent } from "@/lib/mock-agents";
import { AvatarFor, displayName } from "./agent-card";
import { Panel } from "./page-heading";

type Stage = "task" | "review" | "quoting" | "settling" | "paid";

const FIELD = "mt-2 block w-full border-b border-ink bg-transparent py-3 text-[13px] normal-case tracking-normal outline-none focus:bg-cobalt-pale/60";
const PRIMARY =
  "cursor-pointer border border-ink bg-cobalt px-5 py-[15px] text-[13px] tracking-[.08em] text-ink transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A safe preview of the x402 checkout for mock agents: the same steps as the live flow
 * (task → review → authorize) with no server call and no real payment.
 */
export function MockX402Gateway({ agent }: { agent: MockAgent }) {
  const [task, setTask] = useState("");
  const [stage, setStage] = useState<Stage>("task");
  const [error, setError] = useState<string | null>(null);

  // Walk the simulated payment through quoting and settling.
  useEffect(() => {
    if (stage !== "quoting" && stage !== "settling") return;
    const t = setTimeout(() => setStage(stage === "quoting" ? "settling" : "paid"), stage === "quoting" ? 900 : 1400);
    return () => clearTimeout(t);
  }, [stage]);

  function submitTask(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!task.trim()) return setError("Describe the task first.");
    setStage("review");
  }

  const rows = [
    { label: "Agent", value: `${displayName(agent)} · ${agent.ensName}` },
    { label: "Network", value: "Hedera testnet" },
    { label: "Protocol", value: "x402 (HTTP 402 payment required)" },
    { label: "Asset", value: "USDC" },
    { label: "Price", value: `${shortUsdc(agent.price)} USDC per task` },
  ];

  return (
    <div className="grid grid-cols-[1.1fr_1fr] gap-[18px] max-md:grid-cols-1">
      <Panel title={stage === "task" ? "1 · Your task" : stage === "review" ? "2 · Review and authorize" : "3 · Payment"} right={<span className="bg-cobalt px-2 py-0.5 normal-case tracking-normal">preview</span>}>
        {stage === "task" && (
          <form className="flex flex-col gap-5" onSubmit={submitTask}>
            <label className="eyebrow block">
              Task text
              <textarea
                className={`${FIELD} h-40 resize-y`}
                placeholder={agent.taskType === "translate" ? "Text to translate…" : agent.taskType === "code-fix" ? "Describe the failing test…" : "Paste the text you want summarized…"}
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
            </label>
            {error && <p className="m-0 text-bad">{error}</p>}
            <button type="submit" className={PRIMARY}>
              CONTINUE TO X402 CHECKOUT →
            </button>
          </form>
        )}

        {stage !== "task" && (
          <div className="flex flex-col gap-5">
            <dl className="m-0 divide-y divide-line border-y border-line">
              {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[110px_1fr] gap-4 py-2.5">
                  <dt className="eyebrow opacity-60">{r.label}</dt>
                  <dd className="m-0 break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 max-h-32 overflow-y-auto border border-line bg-cobalt-pale/50 px-4 py-3 text-[12px] leading-[1.6] whitespace-pre-wrap">{task}</p>

            {stage === "review" && (
              <div className="flex flex-wrap gap-3">
                <button type="button" className={PRIMARY} onClick={() => setStage("quoting")}>
                  AUTHORIZE X402 PAYMENT →
                </button>
                <button type="button" className="cursor-pointer border border-ink px-5 py-[15px] text-[13px] tracking-[.08em] hover:bg-cobalt-pale" onClick={() => setStage("task")}>
                  EDIT TASK
                </button>
              </div>
            )}
            {stage === "quoting" && <p className="m-0 animate-pulse-dot">Requesting the x402 quote from the agent…</p>}
            {stage === "settling" && <p className="m-0 animate-pulse-dot">Settling {shortUsdc(agent.price)} USDC on Hedera…</p>}
            {stage === "paid" && (
              <div className="border-l-[5px] border-good bg-good/10 px-4 py-3 leading-[1.6]">
                <p className="m-0 font-medium">Preview payment authorized.</p>
                <p className="m-0 mt-1 text-[11px] opacity-80">
                  Nothing was charged: this is a mock agent. A live agent pays from your buyer agent and returns the result here with
                  its HashScan receipt.
                </p>
                <p className="m-0 mt-2 flex flex-wrap gap-x-4">
                  <button type="button" className="cursor-pointer border-b" onClick={() => { setStage("task"); setTask(""); }}>
                    Start another task
                  </button>
                  <Link className="border-b" href="/agents">
                    Browse live agents →
                  </Link>
                </p>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="What you are paying for">
        <div className="flex items-start gap-5">
          <AvatarFor agent={agent} size={88} />
          <div className="min-w-0">
            <h3 className="m-0 text-[26px] leading-none">{displayName(agent)}</h3>
            <p className="m-0 mt-2 text-[11px] break-all opacity-60">{agent.ensName}</p>
            <p className="m-0 mt-3 leading-[1.5]">{agent.description}</p>
          </div>
        </div>
        <dl className="m-0 mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
          {[
            { label: "score", value: agent.score },
            { label: "verified votes", value: String(agent.votes) },
            { label: "counted hires", value: `${agent.hiresCounted}/${agent.hiresTotal}` },
          ].map((f) => (
            <div key={f.label}>
              <dd className="m-0 font-serif text-[26px] leading-none">{f.value}</dd>
              <dt className="eyebrow mt-2 opacity-60">{f.label}</dt>
            </div>
          ))}
        </dl>
        <p className="m-0 mt-5 border-t border-line pt-3 text-[11px] leading-[1.5] opacity-70">
          Your buyer agent pays over x402 in USDC on Hedera. The hire is written to the HireLedger, and your rating counts once, only
          if you are a different verified person from the provider.
        </p>
      </Panel>
    </div>
  );
}
