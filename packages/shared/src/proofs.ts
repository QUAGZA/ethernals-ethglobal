/** Server <-> web types for verified work (validation receipts, per-category capabilities, subcontracting). */
import type { CapabilityRecord, ReceiptCheck, TaskCategory, ValidationReceipt } from "./receipt";
import type { Hex, InferenceReceipt } from "./tasks";

export interface ProofView {
  id: string;
  /** The agent that produced the output being validated (the executor). */
  agent: string;
  /** Set when this proof is a subtask the `agent` bought from another agent. */
  parentProofId: string | null;
  category: TaskCategory;
  title: string;
  /** Output of the EXECUTING agent: only its hash is shown as evidence, never trusted for the verdict. */
  patchHash: Hex;
  /** The verdict comes only from the independent validator. */
  validator: { id: string; version: string; address: Hex; isolation: "docker" | "none" };
  receipt: ValidationReceipt;
  receiptHash: Hex;
  /** Live integrity check, re-computed on every read (database hash, then on-chain commitment when available). */
  check: ReceiptCheck;
  /** "settled" = escrow released/refunded on-chain; "none" = no escrow in this run (local demo). */
  settlement: { status: "paid" | "refunded" | "none"; txHash: Hex | null; txUrl: string | null };
  /** x402 payment that bought this work. Null unless a real paid hire was linked (the local demo does not move money). */
  payment: { amountUsdc: string; txUrl: string | null } | null;
  resultUrl: string | null;
  /** 0G Compute calls the executing agent made to produce this output (empty for scripted demo patches). */
  inference: InferenceReceipt[];
  logTail: string[];
  createdAt: string;
}

/** POST /api/proofs/demo */
export interface RunProofRequest {
  /** Which reference patch the executing agent "submits": the strong one passes, the weak one fails the hidden tests. */
  patch: "good" | "weak";
  agent?: string;
}

/** POST /api/proofs/subcontract: an agent breaks a job in two and buys a subtask from a specialist. */
export interface SubcontractRequest {
  /** The prime agent. */
  agent: string;
  /** The specialist it hires. */
  specialist: string;
  /** What the specialist submits (demo control). Default "good". If the sub fails validation the parent cannot use it and fails too. */
  specialistPatch?: "good" | "weak";
}

export interface SubcontractResponse {
  parent: ProofView;
  sub: ProofView;
}

/** GET /api/agents/:label/capabilities */
export interface CapabilitiesView {
  agent: string;
  /** Per-category records derived only from validation receipts. */
  records: (CapabilityRecord & { credential: "bronze" | "silver" | "gold" | null })[];
  totalVerified: number;
}

/** POST /api/proofs/live: a real coding agent thinks on 0G, writes the fix, and the independent validator grades it. */
export interface RunLiveProofRequest {
  agent?: string;
}

/** GET /api/brain */
export interface BrainStatusView {
  enabled: boolean;
  network: "testnet" | "mainnet";
  baseUrl: string;
  keyConfigured: boolean;
  /** How many API keys (accounts) agents are spread across. */
  keys: number;
  managementKeyConfigured: boolean;
  model: string | null;
  reachable: boolean;
  error: string | null;
  calls: number;
  /** Total model cost so far, neuron (1e18 neuron = 1 0G). */
  spentNeuron: string;
}
