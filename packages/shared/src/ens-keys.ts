/**
 * ENS text record keys written for every agent subname (PRD §11.3).
 * Reputation keys are written only by the platform's verifier wallet.
 */
export const RECORD_PREFIX = "ethernals";

export const ENS_KEYS = {
  description: "description",
  endpoint: "agent-endpoint[x402]",
  context: "agent-context",
  provider: `${RECORD_PREFIX}.provider`,
  basePrice: `${RECORD_PREFIX}.basePrice`,
  price: `${RECORD_PREFIX}.price`,
  score: `${RECORD_PREFIX}.score`,
  votes: `${RECORD_PREFIX}.votes`,
  hiresCounted: `${RECORD_PREFIX}.hires.counted`,
  hiresTotal: `${RECORD_PREFIX}.hires.total`,
  ledger: `${RECORD_PREFIX}.ledger`,
  updated: `${RECORD_PREFIX}.updated`,
} as const;

export type EnsKey = (typeof ENS_KEYS)[keyof typeof ENS_KEYS];

/** Keys shown on the agent page "live from ENS" panel, in display order. */
export const ENS_DISPLAY_KEYS: { key: EnsKey; label: string }[] = [
  { key: ENS_KEYS.score, label: "Score" },
  { key: ENS_KEYS.price, label: "Price (USDC)" },
  { key: ENS_KEYS.votes, label: "Votes (distinct people)" },
  { key: ENS_KEYS.hiresCounted, label: "Counted hires" },
  { key: ENS_KEYS.hiresTotal, label: "All hires" },
  { key: ENS_KEYS.basePrice, label: "Base price" },
  { key: ENS_KEYS.provider, label: "Provider key" },
  { key: ENS_KEYS.endpoint, label: "x402 endpoint" },
  { key: ENS_KEYS.ledger, label: "Ledger" },
  { key: ENS_KEYS.updated, label: "Updated" },
];

/** Labels must be lowercase letters, digits and hyphens (a safe subset of ENS normalization). */
export const LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function assertValidLabel(label: string): void {
  if (!LABEL_REGEX.test(label)) {
    throw new Error(
      `"${label}" is not a valid agent name. Use 1-32 lowercase letters, digits or hyphens (not at the start or end).`,
    );
  }
}
