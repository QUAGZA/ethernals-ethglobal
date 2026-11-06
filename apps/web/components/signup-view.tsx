"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MeResponse, RpContext } from "@ethernals/shared";
import type { IDKitResult } from "@worldcoin/idkit";
import { ApiRequestError, api, toApiError } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { ErrorNotice } from "./error-notice";
import { PageHeading } from "./page-heading";
import { useToast } from "./toast-provider";

const WorldIdWidget = dynamic(() => import("./world-id-widget"), { ssr: false });

/** Lowercase letters, digits and hyphens, at most 24 characters, no hyphen at either end. */
const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

function handleProblem(handle: string): string | null {
  if (!handle) return "Pick a handle first.";
  if (handle.length > 24) return "At most 24 characters.";
  if (!HANDLE_REGEX.test(handle)) return "Use lowercase letters, digits and hyphens, not starting or ending with a hyphen.";
  if (handle.slice(2, 4) === "--") return "A handle cannot have “--” as its 3rd and 4th characters (an ENS rule).";
  return null;
}

const IDKIT_ERRORS: Record<string, string> = {
  user_rejected: "You declined the request in World App.",
  verification_rejected: "The verification was rejected.",
  credential_unavailable: "This World ID does not have the needed credential.",
  invalid_network: "World App and this site are on different environments (staging vs production).",
  connection_failed: "Could not connect to World App. Try again.",
  timeout: "The request timed out. Try again.",
  cancelled: "The request was cancelled.",
  max_verifications_reached: "This World ID has already verified for this action.",
  nullifier_replayed: "This World ID proof was already used.",
  invalid_rp_signature: "The server's request signature was rejected (check WORLD_RP_SIGNING_KEY).",
  duplicate_nonce: "This request was already used. Click Verify again for a fresh one.",
  rp_signature_expired: "The request expired. Click Verify again.",
  failed_by_host_app: "Our server did not accept the proof.",
};

/** Safe in-app redirect target from ?next=. */
function readNext(): string {
  if (typeof window === "undefined") return "/me";
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/me";
}

export function SignupView() {
  const router = useRouter();
  const toast = useToast();
  const { config, configError, me, setMe } = useApp();
  const [handle, setHandle] = useState("");
  const [touched, setTouched] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devBusy, setDevBusy] = useState(false);
  const [next, setNext] = useState("/me");
  const verified = useRef<MeResponse | null>(null);
  const serverError = useRef<ApiRequestError | null>(null);

  useEffect(() => setNext(readNext()), []);

  const problem = handleProblem(handle);

  function welcome(result: MeResponse, requested: string) {
    setMe(result);
    const actual = result.person?.handle;
    if (actual && actual !== requested) {
      const msg = `This World ID is already registered as @${actual}, so we signed you in instead of creating a second person.`;
      setNotice(msg);
      toast(msg);
      return true;
    }
    toast(`Welcome, @${actual ?? requested}. Your buyer agent is ready.`);
    return false;
  }

  async function startWorldId(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    setNotice(null);
    if (problem || !config) return;
    setPreparing(true);
    try {
      // A fresh, server-signed request context for every World ID request.
      const ctx = await api.rpContext();
      setRpContext(ctx);
      setOpen(true);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setPreparing(false);
    }
  }

  async function verifyProof(result: IDKitResult) {
    serverError.current = null;
    try {
      verified.current = await api.worldVerify({ handle, proof: result });
    } catch (err) {
      const apiErr = toApiError(err);
      serverError.current = apiErr;
      setError(apiErr);
      throw apiErr; // IDKit shows the failure state
    }
  }

  function onSuccess() {
    const result = verified.current;
    if (!result) return;
    const existing = welcome(result, handle);
    // Give the "already registered" notice a moment on screen.
    setTimeout(() => router.push(next), existing ? 2500 : 300);
  }

  function onWidgetError(code: string) {
    if (code === "failed_by_host_app" && serverError.current) {
      setError(serverError.current);
      return;
    }
    setError(new ApiRequestError(0, IDKIT_ERRORS[code] ?? `World ID error: ${code}`, `IDKit code: ${code}. Close the window and click Verify again to retry.`));
  }

  async function devLogin() {
    setTouched(true);
    setError(null);
    if (problem) return;
    setDevBusy(true);
    try {
      const result = await api.devLogin({ handle });
      const existing = welcome(result, handle);
      setTimeout(() => router.push(next), existing ? 2500 : 300);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setDevBusy(false);
    }
  }

  const signedIn = me?.person ?? null;

  return (
    <>
      <PageHeading eyebrow="Get started · sign up or log in" title={<>Get started.</>}>
        One flow for everyone, with World ID as the only sign-in: no password, no email. New here? Pick a handle and
        we create your person and your buyer agent. Already registered? The same World ID signs you straight into your
        existing account. We ask only for proof that you are one unique human, never your name or documents.
      </PageHeading>

      <section className="grid grid-cols-[1.1fr_1fr] gap-[5vw] px-[2.2vw] py-[3vw] max-md:grid-cols-1 max-md:px-5 max-md:py-8">
        <div className="flex flex-col gap-6">
          {signedIn && !notice && (
            <div className="border border-ink bg-white/60 px-5 py-4 leading-[1.6]">
              You are signed in as <strong>@{signedIn.handle}</strong>.{" "}
              <Link className="border-b" href="/me">
                Go to your page →
              </Link>
            </div>
          )}
          {notice && (
            <div role="status" className="border-l-[5px] border-warn bg-warn/15 px-5 py-4 leading-[1.6]">
              {notice}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <div className="border border-ink bg-cobalt-pale/60 px-4 py-3 leading-[1.5]">
              <p className="eyebrow m-0 font-medium">Sign up</p>
              <p className="m-0 mt-1 text-[11px] opacity-80">Choose a handle below. World ID creates your person and buyer agent.</p>
            </div>
            <div className="border border-ink px-4 py-3 leading-[1.5]">
              <p className="eyebrow m-0 font-medium">Log in</p>
              <p className="m-0 mt-1 text-[11px] opacity-80">Already have an account? Continue with World ID and we sign you in.</p>
            </div>
          </div>

          <form className="flex flex-col gap-6" onSubmit={startWorldId}>
            <label className="eyebrow block">
              Handle
              <input
                className="mt-2 block w-full border-b border-ink bg-transparent py-3 font-serif text-[40px] normal-case tracking-normal outline-none"
                placeholder="bob"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={24}
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                onBlur={() => setTouched(true)}
              />
              <span className="mt-2 block normal-case tracking-normal opacity-70">
                {handle && !problem
                  ? `Your buyer agent will be ${handle}-buyer.${config?.ensParent ?? "…"}`
                  : "Lowercase letters, digits and hyphens, at most 24 characters."}
              </span>
              {touched && problem && <span className="mt-1 block normal-case tracking-normal text-bad">{problem}</span>}
            </label>

            <button
              type="submit"
              disabled={!config || preparing || open}
              className="cursor-pointer border border-ink bg-cobalt px-5 py-[18px] text-[14px] tracking-[.08em] text-ink hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {preparing ? "PREPARING THE REQUEST…" : open ? "WAITING FOR WORLD ID…" : "CONTINUE WITH WORLD ID →"}
            </button>
          </form>

          {config?.world.env === "staging" && (
            <p className="m-0 border border-dashed px-4 py-3 leading-[1.6]">
              Staging: scan with the World ID Simulator —{" "}
              <a className="border-b" href="https://simulator.worldcoin.org" target="_blank" rel="noopener noreferrer">
                simulator.worldcoin.org
              </a>
              . Each Simulator identity is a different person.
            </p>
          )}

          <ErrorNotice error={configError && !config ? configError : null} title="Cannot get started right now" />
          <ErrorNotice error={error} title="World ID problem" />

          {config?.devFakePersons && (
            <div className="border border-bad px-5 py-4">
              <p className="eyebrow m-0 font-medium text-bad">Dev login · DEV_FAKE_PERSONS=true</p>
              <p className="m-0 mt-2 leading-[1.5]">
                Creates a person without World ID. This person is not verified; never use it in the demo.
              </p>
              <button
                className="mt-3 cursor-pointer border border-bad px-4 py-2.5 text-bad hover:bg-bad hover:text-white disabled:opacity-40"
                disabled={devBusy}
                onClick={() => void devLogin()}
              >
                {devBusy ? "SIGNING IN…" : "DEV LOGIN (NO WORLD ID)"}
              </button>
            </div>
          )}
        </div>

        <aside className="border-t pt-6 leading-[1.6] max-md:pt-6">
          <p className="eyebrow m-0">What happens</p>
          <ol className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
            <li className="grid grid-cols-[36px_1fr]">
              <span>01</span>
              <span>Our server signs a fresh World ID request; World App (or the Simulator) answers with a proof.</span>
            </li>
            <li className="grid grid-cols-[36px_1fr]">
              <span>02</span>
              <span>The server verifies the proof with World. A new human gets a person; a returning one is logged in: one human, one person.</span>
            </li>
            <li className="grid grid-cols-[36px_1fr]">
              <span>03</span>
              <span>Your buyer agent gets a Hedera account, an ENS subname and a little test USDC, so it can pay agents for you.</span>
            </li>
          </ol>
        </aside>
      </section>

      {config && rpContext && (
        <WorldIdWidget
          open={open}
          onOpenChange={setOpen}
          config={config}
          rpContext={rpContext}
          handle={handle}
          onVerify={verifyProof}
          onSuccess={onSuccess}
          onError={onWidgetError}
        />
      )}
    </>
  );
}
