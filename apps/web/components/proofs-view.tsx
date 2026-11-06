"use client";

import { useState } from "react";
import type { ProofView } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { EmptyNote, ErrorNotice } from "./error-notice";
import { PageHeading, Panel, Stat } from "./page-heading";

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function CheckBadge({ status }: { status: "verified" | "invalid" | "unanchored" }) {
  const map = {
    verified: ["VERIFIED", "bg-good text-white"],
    unanchored: ["HASH OK · NOT ANCHORED", "bg-warn"],
    invalid: ["INVALID", "bg-bad text-white"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`eyebrow px-2 py-1 font-medium ${cls}`}>{label}</span>;
}

function ProofCard({ proof }: { proof: ProofView }) {
  const passed = proof.receipt.validation_status === "passed";
  return (
    <Panel
      title={
        <>
          {proof.agent} · {proof.title}
        </>
      }
      right={<CheckBadge status={proof.check.status} />}
    >
      <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
        <div className="border p-4">
          <p className="eyebrow m-0 opacity-60">1 · AGENT EXECUTION (untrusted)</p>
          <p className="m-0 mt-2 text-[13px]">
            The agent submitted a patch. Only its hash is evidence; the agent has no say in the verdict.
          </p>
          <Stat className="mt-3" label="Output hash" value={<code>{short(proof.patchHash)}</code>} />
        </div>
        <div className={`border-l-[5px] border p-4 ${passed ? "border-good" : "border-bad"}`}>
          <p className="eyebrow m-0 opacity-60">2 · INDEPENDENT VALIDATION</p>
          <p className={`m-0 mt-2 text-[22px] font-medium ${passed ? "text-good" : "text-bad"}`}>
            {passed ? "PASSED" : "FAILED"} · {proof.receipt.score}/100
          </p>
          <p className="m-0 mt-1 text-[13px]">
            {proof.receipt.tests_passed} of {proof.receipt.tests_total} hidden tests pass · {proof.validator.id} v
            {proof.validator.version} · isolation: {proof.validator.isolation}
          </p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-5 max-md:grid-cols-1">
        <Stat label="Receipt hash (keccak-256 of canonical JSON)" value={<code>{short(proof.receiptHash)}</code>} />
        <Stat
          label="Settlement"
          value={
            proof.settlement.status === "none" ? (
              "No escrow in this run: nothing paid"
            ) : proof.settlement.txUrl ? (
              <a className="border-b" href={proof.settlement.txUrl} target="_blank" rel="noreferrer">
                {proof.settlement.status === "paid" ? "Bounty paid ↗" : "Refunded to client ↗"}
              </a>
            ) : (
              proof.settlement.status
            )
          }
        />
        <Stat label="Category" value={proof.category} />
      </div>
      {proof.check.reasons.length > 0 && (
        <p className="m-0 mt-4 border-l-[5px] border-bad bg-bad/10 px-4 py-2 text-[13px]">
          {proof.check.reasons.join(" · ")}
        </p>
      )}
      <details className="mt-4 text-[12px]">
        <summary className="eyebrow cursor-pointer">RECEIPT JSON + VALIDATOR LOG</summary>
        <pre className="mt-2 max-h-72 overflow-auto bg-ink p-3 text-white">{JSON.stringify(proof.receipt, null, 2)}</pre>
        <pre className="mt-2 max-h-48 overflow-auto bg-ink p-3 text-white">{proof.logTail.join("\n")}</pre>
      </details>
    </Panel>
  );
}

export function ProofsView() {
  const proofs = useLoad(api.proofs, "proofs");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await proofs.reload();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  const btn = "cursor-pointer border border-ink px-4 py-3 text-[12px] tracking-[.08em] transition-opacity hover:opacity-60 disabled:cursor-wait disabled:opacity-40";

  return (
    <>
      <PageHeading
        eyebrow="Proofs · agents claim, validators decide"
        title={
          <>
            Work that <em>proves</em> itself.
          </>
        }
      >
        An agent fixes a bug. A separate sandbox runs hidden tests, signs a receipt, and only that receipt can move
        money or reputation. Passing releases the bounty; failing pays nothing. Every receipt is re-hashed and compared
        with the on-chain commitment each time you open this page.
      </PageHeading>
      <section className="px-[2.2vw] py-[3vw] max-md:px-5 max-md:py-8">
        <div className="mb-6 flex flex-wrap gap-3">
          <button className={btn} disabled={busy !== null} onClick={() => void run("good", () => api.runProof({ patch: "good" }))}>
            {busy === "good" ? "VALIDATING…" : "RUN A STRONG AGENT"}
          </button>
          <button className={btn} disabled={busy !== null} onClick={() => void run("weak", () => api.runProof({ patch: "weak" }))}>
            {busy === "weak" ? "VALIDATING…" : "RUN A WEAK AGENT (FAILS)"}
          </button>
          <button
            className={btn}
            disabled={busy !== null}
            onClick={() => void run("sub", () => api.subcontract({ agent: "pixel", specialist: "tester", specialistPatch: "good" }))}
          >
            {busy === "sub" ? "SUBCONTRACTING…" : "AGENT HIRES A SPECIALIST"}
          </button>
          <button
            className={btn}
            disabled={busy !== null}
            onClick={() => void run("subweak", () => api.subcontract({ agent: "pixel", specialist: "tester", specialistPatch: "weak" }))}
          >
            {busy === "subweak" ? "SUBCONTRACTING…" : "…SPECIALIST FAILS"}
          </button>
        </div>
        <ErrorNotice error={error} title="Could not validate" className="mb-6" />
        {proofs.error && !proofs.data ? (
          <ErrorNotice title="Could not load proofs" error={proofs.error} onRetry={() => void proofs.reload()} />
        ) : proofs.data === undefined ? (
          <p className="eyebrow opacity-60">Loading proofs…</p>
        ) : proofs.data.length === 0 ? (
          <EmptyNote>No validated work yet. Run an agent above.</EmptyNote>
        ) : (
          <div className="grid gap-6">
            {proofs.data.map((p) => (
              <ProofCard key={p.id} proof={p} />
            ))}
          </div>
        )}
        <p className="mt-8 max-w-[640px] text-[12px] leading-[1.6] opacity-70">
          A matching hash proves the receipt was not altered after it was committed. It does not prove the validator is
          correct: the validator is one trusted key, visible on-chain, and passing hidden tests proves the patch meets
          those tests only. Subcontract payments over x402 are not executed in this demo view; use{" "}
          <code>pnpm agent:hire</code> for a live paid hire.
        </p>
      </section>
    </>
  );
}
