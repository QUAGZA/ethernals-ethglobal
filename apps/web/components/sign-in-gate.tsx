"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { MeResponse, PersonPublic } from "@ethernals/shared";
import { useApp } from "@/lib/app-context";
import { ErrorNotice } from "./error-notice";

/** Link to /signup that brings the person back here afterwards. */
export function SignInLink({ next, children = "SIGN IN WITH WORLD ID →" }: { next?: string; children?: ReactNode }) {
  const href = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";
  return (
    <Link href={href} className="inline-block border border-ink bg-yellow px-5 py-[15px] text-ink hover:bg-ink hover:text-yellow">
      {children}
    </Link>
  );
}

/** Renders children only for a signed-in person; otherwise a sign-in prompt. */
export function SignInGate({
  next,
  reason,
  children,
}: {
  next: string;
  reason: string;
  children: (person: PersonPublic, me: MeResponse) => ReactNode;
}) {
  const { me, meError, refreshMe } = useApp();
  if (me === undefined) return <p className="eyebrow m-0 px-[2.2vw] py-[3vw] opacity-60 max-md:px-5">Checking your session…</p>;
  if (!me.person) {
    return (
      <div className="flex flex-col items-start gap-4 px-[2.2vw] py-[3vw] max-md:px-5 max-md:py-8">
        <ErrorNotice error={meError} title="Could not check your session" onRetry={() => void refreshMe()} />
        <p className="m-0 max-w-[520px] text-[14px] leading-[1.6]">{reason}</p>
        <SignInLink next={next} />
      </div>
    );
  }
  return <>{children(me.person, me)}</>;
}
