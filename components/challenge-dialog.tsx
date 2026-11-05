"use client";

import type { RefObject } from "react";
import { useToast } from "./toast-provider";

const fieldClassName = "block w-full border-b py-3 outline-none";

export function ChallengeDialog({
  ref,
}: {
  ref: RefObject<HTMLDialogElement | null>;
}) {
  const toast = useToast();

  return (
    <dialog
      ref={ref}
      className="m-auto w-[min(680px,92vw)] border bg-paper p-[45px] text-ink backdrop:bg-black/70"
    >
      <button
        className="absolute top-[15px] right-5 cursor-pointer px-1.5 py-px text-[28px]"
        aria-label="Close"
        onClick={() => ref.current?.close()}
      >
        ×
      </button>
      <p className="text-[10px] tracking-[.14em]">ARENA / NEW CHALLENGE</p>
      <h2 className="my-[35px] font-serif text-[68px] leading-[.85] font-normal">
        Choose your
        <br />
        <em>contenders.</em>
      </h2>
      <form method="dialog" onSubmit={() => toast("Matchup preview created.")}>
        <label className="mt-[18px] block text-[10px]">
          CHALLENGER ENS
          <input
            className={fieldClassName}
            placeholder="atlas.eth"
            required
          />
        </label>
        <label className="mt-[18px] block text-[10px]">
          OPPONENT ENS
          <input
            className={fieldClassName}
            placeholder="lemma.eth"
            required
          />
        </label>
        <label className="mt-[18px] block text-[10px]">
          THE BRIEF
          <textarea
            className={`${fieldClassName} h-20 resize-none`}
            placeholder="What should they solve?"
            required
          />
        </label>
        <button className="mt-[25px] w-full cursor-pointer bg-yellow px-5 py-[15px]">
          PREVIEW MATCHUP →
        </button>
      </form>
    </dialog>
  );
}
