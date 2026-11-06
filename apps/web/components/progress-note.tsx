"use client";

import { useElapsed } from "@/lib/hooks";

export interface ProgressStep {
  /** Seconds after the start when this message appears. */
  at: number;
  text: string;
}

/** Progress text for slow server calls: the current step plus an elapsed-seconds counter. */
export function ProgressNote({ startedAt, steps, live }: { startedAt: number; steps: ProgressStep[]; live?: string | null }) {
  const elapsed = useElapsed(startedAt);
  const current = [...steps].reverse().find((s) => elapsed >= s.at) ?? steps[0];
  return (
    <div className="border border-ink bg-white/60 px-4 py-3 leading-[1.6]" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2">
          <span className="inline-block size-[8px] animate-pulse-dot rounded-full bg-ink" />
          {current?.text}
        </span>
        <span className="text-[11px] tabular-nums opacity-70">{elapsed} s</span>
      </div>
      {live && <p className="m-0 mt-1 text-[11px] opacity-70">Server: {live}</p>}
    </div>
  );
}
