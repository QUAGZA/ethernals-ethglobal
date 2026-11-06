/**
 * Reason codes. The order of LEDGER_REASONS must match `enum Reason` in HireLedger.sol.
 */
export const LEDGER_REASONS = [
  "COUNTED",
  "COUNTED_REPLACED_VOTE",
  "SAME_PERSON",
  "UNVERIFIED_BUYER",
  "DUPLICATE_PAYMENT",
  "NO_RATING",
  "INVALID_RATING",
  "UNKNOWN_AGENT",
] as const;

export type LedgerReason = (typeof LEDGER_REASONS)[number];

/** Off-chain outcomes the server can report in addition to ledger reasons. */
export type OffchainReason =
  | "PAYMENT_NOT_VERIFIED"
  | "SUBHIRE_BLOCKED_NO_CONSENT"
  | "SUBHIRE_BLOCKED_BUDGET"
  | "EGRESS_BLOCKED";

export type Reason = LedgerReason | OffchainReason;

export function reasonFromIndex(index: number): LedgerReason {
  const reason = LEDGER_REASONS[index];
  if (!reason) throw new Error(`Unknown ledger reason index ${index}`);
  return reason;
}

export function isCountedReason(reason: Reason): boolean {
  return reason === "COUNTED" || reason === "COUNTED_REPLACED_VOTE";
}

export const REASON_LABELS: Record<Reason, string> = {
  COUNTED: "Counted",
  COUNTED_REPLACED_VOTE: "Counted (replaced this person's earlier vote)",
  SAME_PERSON: "Not counted: same person as the provider",
  UNVERIFIED_BUYER: "Not counted: buyer is not a verified person",
  DUPLICATE_PAYMENT: "Not counted: payment already used",
  NO_RATING: "Not counted: no rating given",
  INVALID_RATING: "Not counted: invalid rating",
  UNKNOWN_AGENT: "Not counted: unknown agent",
  PAYMENT_NOT_VERIFIED: "Not recorded: payment could not be verified",
  SUBHIRE_BLOCKED_NO_CONSENT: "Blocked: hirer did not consent to sharing",
  SUBHIRE_BLOCKED_BUDGET: "Blocked: over the hirer's sub-budget",
  EGRESS_BLOCKED: "Blocked: outbound request not on the allowlist",
};

/** UI tone for badges. */
export function reasonTone(reason: Reason | null | undefined): "good" | "warn" | "bad" | "neutral" {
  if (!reason) return "neutral";
  if (isCountedReason(reason)) return "good";
  if (reason.startsWith("SUBHIRE_BLOCKED") || reason === "EGRESS_BLOCKED" || reason === "PAYMENT_NOT_VERIFIED") return "bad";
  return "warn";
}
