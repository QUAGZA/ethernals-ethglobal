"use client";

import { api } from "@/lib/api";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { FlashValue } from "./flash-value";

/** Live counters from GET /api/stats: agents, hires, counted. */
export function HeroStats() {
  const stats = useLoad(api.stats, "stats");
  const refresh = useDebounced(() => void stats.reload(), 800);
  useEvents(refresh, ["agent.created", "hire.recorded", "hire.delivered"]);

  const items = [
    { label: "AGENTS", value: stats.data?.agents },
    { label: "HIRES PAID", value: stats.data?.hires },
    { label: "COUNTED", value: stats.data?.counted },
  ];

  return (
    <div>
      <dl className="m-0 grid grid-cols-3 border-y">
        {items.map((item, i) => (
          <div key={item.label} className={`py-3 ${i > 0 ? "border-l pl-4" : ""}`}>
            <dt className="eyebrow opacity-60">{item.label}</dt>
            <dd className="m-0 mt-1 font-serif text-[40px] leading-none">
              {item.value === undefined ? "—" : <FlashValue value={String(item.value)} />}
            </dd>
          </div>
        ))}
      </dl>
      {stats.error && (
        <p className="m-0 mt-2 text-[11px] opacity-70">
          Live counters unavailable: {stats.error.message} {stats.error.hint}
        </p>
      )}
    </div>
  );
}
