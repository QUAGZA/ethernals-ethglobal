import { REASON_LABELS, reasonTone, type Reason } from "@ethernals/shared";

const toneClass = {
  good: "bg-good text-white border-good",
  warn: "bg-warn text-ink border-warn",
  bad: "bg-bad text-white border-bad",
  neutral: "border-current",
} as const;

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REASON_LABELS[reason as Reason] ?? reason;
}

/** A colored reason code: COUNTED green, SAME_PERSON / UNVERIFIED_BUYER amber, blocked / unverified payment red. */
export function ReasonBadge({
  reason,
  size = "sm",
  withLabel = false,
}: {
  reason: string | null | undefined;
  size?: "sm" | "lg";
  withLabel?: boolean;
}) {
  if (!reason) return null;
  const tone = reasonTone(reason as Reason);
  const sizeClass = size === "lg" ? "px-3 py-2 text-[14px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={`inline-block border font-medium tracking-[.06em] whitespace-nowrap ${sizeClass} ${toneClass[tone]}`}
        title={reasonLabel(reason)}
      >
        {reason}
      </span>
      {withLabel && <span className={size === "lg" ? "text-[14px]" : ""}>{reasonLabel(reason)}</span>}
    </span>
  );
}

/** A plain tag for statuses that are not reason codes yet (e.g. "awaiting rating"). */
export function StatusTag({ children, tone = "neutral" }: { children: string; tone?: keyof typeof toneClass }) {
  return (
    <span className={`inline-block border px-1.5 py-0.5 text-[10px] tracking-[.06em] whitespace-nowrap ${toneClass[tone]}`}>
      {children}
    </span>
  );
}
