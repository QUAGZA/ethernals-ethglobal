import type { SubHireOutcome } from "@ethernals/shared";
import { PaymentLink } from "./ext-link";
import { ReasonBadge, StatusTag, reasonLabel } from "./reason-badge";

/** One sub-hire: the "also translate to Hindi" step, or an assistant the agent recruited. */
export function SubHireOutcomeView({ subHire }: { subHire: SubHireOutcome | null }) {
  if (!subHire) return null;
  const target = subHire.agentEnsName ?? "the sub-agent";
  return (
    <div className="border-t border-line pt-4">
      <p className="eyebrow m-0 mb-2 opacity-60">Sub-hire</p>
      {subHire.status === "blocked" && (
        <div className="flex flex-col gap-2 leading-[1.5]">
          {subHire.reason ? (
            <span>
              <ReasonBadge reason={String(subHire.reason)} />
            </span>
          ) : (
            <span>
              <StatusTag tone="bad">BLOCKED</StatusTag>
            </span>
          )}
          <p className="m-0">
            {subHire.reason ? `${reasonLabel(String(subHire.reason))}. ` : ""}
            The agent tried to send your data to {target}; our code stopped it. You got the result without the sub-hire.
          </p>
        </div>
      )}
      {subHire.status === "done" && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 leading-[1.5]">
          <StatusTag tone="good">SUB-HIRED</StatusTag>
          <span>
            {target} was hired and paid{subHire.amount ? ` ${subHire.amount} USDC` : ""} from this agent&apos;s own account, within your sub-budget.
          </span>
          <PaymentLink href={subHire.paymentUrl} />
        </div>
      )}
      {subHire.status === "skipped" && (
        <p className="m-0 leading-[1.5]">
          <StatusTag>SKIPPED</StatusTag> {subHire.reason ? reasonLabel(String(subHire.reason)) : "No sub-hire was needed."}
        </p>
      )}
      {subHire.status === "failed" && (
        <p className="m-0 leading-[1.5]">
          <StatusTag tone="bad">SUB-HIRE FAILED</StatusTag> {subHire.reason ? reasonLabel(String(subHire.reason)) : ""}
        </p>
      )}
    </div>
  );
}
