"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type FormEvent } from "react";
import type { AgentDetail, EventMessage, HireResponse, HireView } from "@ethernals/shared";
import { parseUnits6 } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { shortUsdc, usdc2 } from "@/lib/format";
import { useInterval } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { ErrorNotice } from "./error-notice";
import { ExtLink, LedgerLink, PaymentLink } from "./ext-link";
import { ProgressNote, type ProgressStep } from "./progress-note";
import { ReasonBadge } from "./reason-badge";
import { SignInLink } from "./sign-in-gate";
import { StarRating } from "./star-rating";
import { SubHireOutcomeView } from "./sub-hire-outcome";

const MAX_INPUT = 8000;
const POLL_MS = 3000;

const HIRE_STEPS: ProgressStep[] = [
  { at: 0, text: "Your buyer agent is reading this agent's price from ENS…" },
  { at: 3, text: "Getting the x402 quote and paying in USDC on Hedera…" },
  { at: 9, text: "The payment is settling through the x402 facilitator…" },
  { at: 16, text: "Paid. The agent is working on your task…" },
  { at: 35, text: "Still working. An LLM task can take up to a minute…" },
];

const RECORD_STEPS: ProgressStep[] = [
  { at: 0, text: "Rating received. Checking the payment on the Hedera mirror node…" },
  { at: 4, text: "Checking that you are a verified person, different from the provider…" },
  { at: 8, text: "Writing the hire to the HireLedger on Hedera…" },
  { at: 20, text: "Waiting for the ledger transaction to confirm…" },
  { at: 45, text: "Still waiting. The verifier retries until the ledger accepts it…" },
];

type Snapshot = { score: string; price: string };
type RateState = "idle" | "sending" | "waiting" | "done";

const fieldClass = "block w-full border-b border-ink bg-transparent py-3 outline-none focus:bg-white/60";

function Check({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="opacity-60">…</span>;
  return ok ? <span className="text-good">✓</span> : <span className="text-bad">✗</span>;
}

function FinalOutcome({ hire, before, after }: { hire: HireView; before: Snapshot | null; after: Snapshot | null }) {
  const counted = hire.counted === true;
  const paid = hire.status !== "payment_not_verified";
  const reason = hire.reason ?? (hire.status === "payment_not_verified" ? "PAYMENT_NOT_VERIFIED" : null);
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4" aria-live="polite">
      <ReasonBadge reason={reason} size="lg" withLabel />
      <p className="m-0 text-[15px]">
        Paid <Check ok={paid} /> · Counted <Check ok={counted} />
        {hire.rating ? ` · you rated ${hire.rating}★` : ""}
      </p>
      {before && after && (
        <p className="m-0 font-serif text-[26px] leading-[1.2]">
          score {before.score} → <span className={counted ? "bg-cobalt px-1" : ""}>{after.score}</span>, price{" "}
          {shortUsdc(before.price)} → <span className={counted ? "bg-cobalt px-1" : ""}>{shortUsdc(after.price)}</span> USDC
        </p>
      )}
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        <PaymentLink href={hire.paymentUrl} />
        <LedgerLink href={hire.ledgerUrl} />
        <ExtLink href={hire.ensUrl} className="text-[11px]">
          ENS update tx
        </ExtLink>
      </span>
      {counted && (
        <p className="m-0 text-[11px] opacity-70">
          The new score and price are written to ENS in one transaction. Watch the “Live from ENS” panel update.
        </p>
      )}
    </div>
  );
}

export function HirePanel({
  agent,
  reloadAgent,
}: {
  agent: AgentDetail;
  reloadAgent: () => Promise<AgentDetail | undefined>;
}) {
  const { me, refreshMe } = useApp();
  const [input, setInput] = useState("");
  const [translate, setTranslate] = useState(false);
  const [forward, setForward] = useState(false);
  const [subBudget, setSubBudget] = useState("0.05");
  const [formError, setFormError] = useState<string | null>(null);

  const [hiringSince, setHiringSince] = useState<number | null>(null);
  const [hireError, setHireError] = useState<ApiRequestError | null>(null);
  const [result, setResult] = useState<HireResponse | null>(null);
  const [before, setBefore] = useState<Snapshot | null>(null);

  const [rating, setRating] = useState(0);
  const [rateState, setRateState] = useState<RateState>("idle");
  const [rateError, setRateError] = useState<ApiRequestError | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [finalHire, setFinalHire] = useState<HireView | null>(null);
  const [after, setAfter] = useState<Snapshot | null>(null);

  const recordedEvent = useRef<EventMessage | null>(null);
  const finalizing = useRef(false);
  const hireIdRef = useRef<string | null>(null);

  const person = me?.person ?? null;
  const isOwner = Boolean(person && person.handle === agent.ownerHandle);

  const finalize = useCallback(
    async (view?: HireView) => {
      const hireId = hireIdRef.current;
      if (!hireId || finalizing.current) return;
      finalizing.current = true;
      try {
        const hire = view ?? (await api.getHire(hireId));
        if (hireIdRef.current !== hireId) return;
        setFinalHire(hire);
        setRateState("done");
        setWaitingSince(null);
        const ev = recordedEvent.current;
        const evScore = ev && typeof ev.data.score === "string" ? ev.data.score : null;
        const evPrice = ev && typeof ev.data.price === "string" ? ev.data.price : null;
        const fresh = await reloadAgent();
        if (hireIdRef.current !== hireId) return;
        if (evScore && evPrice) setAfter({ score: evScore, price: evPrice });
        else if (fresh) setAfter({ score: fresh.score, price: fresh.price });
        void refreshMe();
      } catch (err) {
        setRateError(toApiError(err));
        finalizing.current = false;
      }
    },
    [reloadAgent, refreshMe],
  );

  // The final outcome arrives on the event stream...
  useEvents(
    (message) => {
      const hireId = hireIdRef.current;
      if (!hireId || message.data.hireId !== hireId) return;
      recordedEvent.current = message;
      if (rateState === "waiting" || rateState === "sending") void finalize();
    },
    ["hire.recorded", "hire.payment_not_verified"],
  );

  // ...and, as a fallback, from polling GET /api/hires/:id every 3 s.
  useInterval(
    async () => {
      const hireId = hireIdRef.current;
      if (!hireId) return;
      try {
        const hire = await api.getHire(hireId);
        if (hire.status === "recorded" || hire.status === "payment_not_verified") void finalize(hire);
      } catch {
        /* keep waiting; the next poll or the SSE event will finish it */
      }
    },
    rateState === "waiting" ? POLL_MS : null,
  );

  async function submitHire(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setHireError(null);
    const text = input.trim();
    if (!text) return setFormError("Write the text you want the agent to work on.");
    if (text.length > MAX_INPUT) return setFormError(`Keep the text under ${MAX_INPUT} characters.`);
    try {
      parseUnits6(subBudget);
    } catch (err) {
      return setFormError(`Sub-budget: ${(err as Error).message}`);
    }

    setResult(null);
    setFinalHire(null);
    setAfter(null);
    setRating(0);
    setRateState("idle");
    setRateError(null);
    recordedEvent.current = null;
    finalizing.current = false;
    hireIdRef.current = null;
    setBefore({ score: agent.score, price: agent.price });
    setHiringSince(Date.now());
    try {
      const res = await api.hire({
        agent: agent.label,
        input: text,
        translateTo: translate ? "hi" : null,
        consent: { forward, subBudget: subBudget.trim() },
      });
      hireIdRef.current = res.hireId;
      setResult(res);
      void reloadAgent();
      void refreshMe();
    } catch (err) {
      setHireError(toApiError(err));
    } finally {
      setHiringSince(null);
    }
  }

  async function submitRating() {
    const hireId = hireIdRef.current;
    if (!hireId || rating < 1) return;
    setRateError(null);
    setRateState("sending");
    try {
      const res = await api.rate(hireId, rating);
      if (res.hire.status === "recorded" || res.hire.status === "payment_not_verified") {
        setRateState("waiting");
        void finalize(res.hire);
        return;
      }
      setRateState("waiting");
      setWaitingSince(Date.now());
      void reloadAgent();
      if (recordedEvent.current) void finalize();
    } catch (err) {
      setRateError(toApiError(err));
      setRateState("idle");
    }
  }

  function reset() {
    hireIdRef.current = null;
    recordedEvent.current = null;
    finalizing.current = false;
    setResult(null);
    setFinalHire(null);
    setAfter(null);
    setBefore(null);
    setRating(0);
    setRateState("idle");
    setRateError(null);
    setHireError(null);
    setWaitingSince(null);
  }

  const hiring = hiringSince !== null;

  return (
    <div className="grid grid-cols-2 gap-[18px] max-md:grid-cols-1">
      {/* ---- the form ---- */}
      <section className="border">
        <header className="eyebrow flex items-center justify-between border-b px-5 py-3.5">
          <span className="font-medium">Hire {agent.ensName}</span>
          <span className="normal-case tracking-normal">{shortUsdc(agent.price)} USDC per task</span>
        </header>
        {me === undefined ? (
          <p className="eyebrow m-0 px-5 py-5 opacity-60">Checking your session…</p>
        ) : !person ? (
          <div className="flex flex-col items-start gap-4 px-5 py-5">
            <p className="m-0 max-w-[460px] text-[14px] leading-[1.6]">
              Hiring needs a verified person: your buyer agent pays from its own Hedera account, and your rating
              counts only because World ID shows you are a different human from the provider.
            </p>
            <SignInLink next={`/agents/${agent.label}`} />
          </div>
        ) : (
          <form className="flex flex-col gap-5 px-5 py-5" onSubmit={submitHire}>
            <label className="eyebrow block">
              Task text
              <textarea
                className={`${fieldClass} mt-1 h-40 resize-y text-[13px] normal-case tracking-normal`}
                placeholder={agent.taskType === "translate" ? "Text to translate…" : "Paste the text you want summarized…"}
                value={input}
                maxLength={MAX_INPUT + 200}
                disabled={hiring}
                onChange={(e) => setInput(e.target.value)}
              />
              <span className={`mt-1 block text-right normal-case tracking-normal ${input.length > MAX_INPUT ? "text-bad" : "opacity-50"}`}>
                {input.length}/{MAX_INPUT}
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 leading-[1.5]">
              <input type="checkbox" className="mt-0.5 size-4 accent-ink" checked={translate} disabled={hiring} onChange={(e) => setTranslate(e.target.checked)} />
              <span>
                Also translate to Hindi
                <span className="block text-[11px] opacity-60">The agent then needs a sub-agent (a translator) for part of the work.</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 leading-[1.5]">
              <input type="checkbox" className="mt-0.5 size-4 accent-ink" checked={forward} disabled={hiring} onChange={(e) => setForward(e.target.checked)} />
              <span>
                Allow this agent to share my data with a sub-agent
                <span className="block text-[11px] opacity-60">
                  Off by default. When off, our code blocks any attempt to send your text to another agent.
                </span>
              </span>
            </label>

            <label className="eyebrow block">
              Sub-budget (USDC the agent may spend on sub-hires)
              <input
                className={`${fieldClass} mt-1 text-[13px] normal-case tracking-normal`}
                inputMode="decimal"
                value={subBudget}
                disabled={hiring}
                onChange={(e) => setSubBudget(e.target.value)}
              />
            </label>

            {isOwner && (
              <p className="m-0 border-l-[5px] border-warn bg-warn/15 px-4 py-3 leading-[1.5]">
                You are this agent&apos;s provider. Your hire will settle on Hedera but be recorded as SAME_PERSON and
                will not move the score.
              </p>
            )}
            {person.credentialExpired && (
              <p className="m-0 border-l-[5px] border-warn bg-warn/15 px-4 py-3 leading-[1.5]">
                Your human pass is expired, so this hire will be recorded as UNVERIFIED_BUYER.{" "}
                <Link className="border-b" href="/me">
                  Manage it on /me
                </Link>
                .
              </p>
            )}
            {me?.buyerAgent && (
              <p className="m-0 text-[11px] leading-[1.5] opacity-70">
                Paid by your buyer agent {me.buyerAgent.ensName} · balance {usdc2(me.buyerAgent.usdcBalance)} USDC ·
                budget left {usdc2(me.buyerAgent.budgetRemaining)} USDC
              </p>
            )}
            {formError && <p className="m-0 text-bad">{formError}</p>}

            <button
              type="submit"
              disabled={hiring}
              className="cursor-pointer border border-ink bg-cobalt px-5 py-[15px] text-[13px] tracking-[.08em] text-ink hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {hiring ? "HIRING…" : `HIRE FOR ${shortUsdc(agent.price)} USDC →`}
            </button>
          </form>
        )}
      </section>

      {/* ---- the result ---- */}
      <section className="flex flex-col border">
        <header className="eyebrow flex items-center justify-between border-b px-5 py-3.5">
          <span className="font-medium">Result</span>
          {result && rateState !== "sending" && rateState !== "waiting" && (
            <button className="cursor-pointer border-b normal-case tracking-normal" onClick={reset}>
              Clear
            </button>
          )}
        </header>
        <div className="flex flex-1 flex-col gap-4 px-5 py-5">
          {hiring && hiringSince !== null && <ProgressNote startedAt={hiringSince} steps={HIRE_STEPS} />}
          <ErrorNotice error={hireError} title="The hire did not go through" />

          {!hiring && !result && !hireError && (
            <p className="m-0 leading-[1.6] opacity-60">
              The agent&apos;s answer appears here, with the HashScan link for your payment. Then you rate it, and the
              ledger decides whether your rating counts.
            </p>
          )}

          {result && (
            <>
              <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span>
                  Paid <span className="text-good">✓</span> {result.quotedPrice} USDC
                </span>
                <PaymentLink href={result.paymentUrl} />
                {!result.paymentUrl && <span className="text-[11px] opacity-60">payment id pending</span>}
              </p>
              <div className="max-h-[340px] overflow-y-auto border border-line bg-white/70 px-4 py-3 text-[13px] leading-[1.6] whitespace-pre-wrap">
                {result.result}
              </div>
              <SubHireOutcomeView subHire={result.subHire} />

              <div className={rateState === "done" && !rateError ? "hidden" : "border-t border-line pt-4"}>
                {rateState === "idle" && (
                  <div className="flex flex-col gap-3">
                    <p className="eyebrow m-0">Rate this result</p>
                    <div className="flex flex-wrap items-center gap-4">
                      <StarRating value={rating} onChange={setRating} />
                      <button
                        className="cursor-pointer border border-ink px-5 py-3 hover:bg-cobalt disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={rating < 1}
                        onClick={() => void submitRating()}
                      >
                        {rating ? `SUBMIT ${rating}★ →` : "PICK 1–5 STARS"}
                      </button>
                    </div>
                  </div>
                )}
                {rateState === "sending" && <p className="m-0 opacity-70">Sending your rating…</p>}
                {rateState === "waiting" && waitingSince !== null && <ProgressNote startedAt={waitingSince} steps={RECORD_STEPS} />}
                <ErrorNotice className="mt-3" error={rateError} title="Rating problem" />
              </div>

              {rateState === "done" && finalHire && <FinalOutcome hire={finalHire} before={before} after={after} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
