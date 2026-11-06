import Link from "next/link";
import type { HireView } from "@ethernals/shared";
import { dateTimeOf } from "@/lib/format";
import { LedgerLink, PaymentLink } from "./ext-link";
import { ReasonBadge, StatusTag } from "./reason-badge";

function Outcome({ hire }: { hire: HireView }) {
  if (hire.reason) return <ReasonBadge reason={hire.reason} />;
  switch (hire.status) {
    case "delivered":
      return <StatusTag>AWAITING RATING</StatusTag>;
    case "rated":
      return <StatusTag>RECORDING…</StatusTag>;
    case "payment_not_verified":
      return <ReasonBadge reason="PAYMENT_NOT_VERIFIED" />;
    case "failed":
      return <StatusTag tone="bad">FAILED</StatusTag>;
    default:
      return <StatusTag>{String(hire.status).toUpperCase()}</StatusTag>;
  }
}

function AgentCell({ ensName }: { ensName: string }) {
  const label = ensName.split(".")[0];
  return (
    <Link className="border-b border-current/40" href={`/agents/${label}`}>
      {ensName}
    </Link>
  );
}

/** Hire history: time, (agent), buyer, rating, reason, Payment ↗, Ledger ↗. */
export function HireTable({
  hires,
  showAgent = false,
  showBuyer = true,
  highlightId,
}: {
  hires: HireView[];
  showAgent?: boolean;
  showBuyer?: boolean;
  highlightId?: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="eyebrow border-b opacity-60">
            <th className="px-3 py-2.5 font-normal">Time</th>
            {showAgent && <th className="px-3 py-2.5 font-normal">Agent</th>}
            {showBuyer && <th className="px-3 py-2.5 font-normal">Buyer</th>}
            <th className="px-3 py-2.5 font-normal">Paid</th>
            <th className="px-3 py-2.5 font-normal">Rating</th>
            <th className="px-3 py-2.5 font-normal">Reason</th>
            <th className="px-3 py-2.5 font-normal">Links</th>
          </tr>
        </thead>
        <tbody>
          {hires.map((h) => (
            <tr key={h.id} className={`border-b border-line align-baseline ${h.id === highlightId ? "bg-cobalt/40" : ""}`}>
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{dateTimeOf(h.createdAt)}</td>
              {showAgent && (
                <td className="px-3 py-2.5">
                  <AgentCell ensName={h.agentEnsName} />
                </td>
              )}
              {showBuyer && (
                <td className="px-3 py-2.5">
                  @{h.buyerHandle}
                  <span className="block text-[10px] opacity-60">
                    {h.buyerAgentEnsName}
                    {h.parentHireId ? " · sub-hire" : ""}
                  </span>
                </td>
              )}
              <td className="px-3 py-2.5 whitespace-nowrap">{h.paidAmount ?? (h.paymentTxId ? h.quotedPrice : "—")}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{h.rating ? `${"★".repeat(h.rating)}${"☆".repeat(Math.max(0, 5 - h.rating))}` : "—"}</td>
              <td className="px-3 py-2.5">
                <Outcome hire={h} />
              </td>
              <td className="px-3 py-2.5">
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  <PaymentLink href={h.paymentUrl} />
                  <LedgerLink href={h.ledgerUrl} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
