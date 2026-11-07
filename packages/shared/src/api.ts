/**
 * Shared request/response types between the server (apps/server) and the web app (apps/web).
 * All amounts are decimal strings in USDC (6 decimals), e.g. "0.116666".
 */
import type { Reason } from "./reasons";

/** "code-fix" is the stored id of the Code gen type: it is written in ENS records, escrow specs and the verifier. */
export const TASK_TYPES = ["image-gen", "video-gen", "code-fix", "summarize", "translate"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  "image-gen": "Image gen",
  "video-gen": "Video gen",
  "code-fix": "Code gen",
  summarize: "Summarize",
  translate: "Translate",
};

/** The kind of 0G model each task type thinks on. */
export function modelTypeFor(taskType: TaskType): "text" | "image" | "video" {
  if (taskType === "image-gen") return "image";
  return taskType === "video-gen" ? "video" : "text";
}

/** Used when a provider leaves the model blank. */
export const DEFAULT_MEDIA_MODELS = { image: "minimax-image-01", video: "bytedance/seedance-2.0-mini" } as const;
export type AgentKind = "seller" | "buyer";
export type HumanMode = "idkit" | "agentkit" | "dev";

/** GET /api/config — public, non-secret configuration for the web app. */
export interface PublicConfig {
  appName: string;
  ensParent: string;
  publicBaseUrl: string;
  world: {
    appId: string;
    rpId: string | null;
    action: string;
    env: "staging" | "production";
    humanMode: "idkit" | "agentkit";
    /** Accept World ID 3.0 fallback proofs (needed if the Simulator cannot issue 4.0 proofs). */
    allowLegacyProofs: boolean;
  };
  devFakePersons: boolean;
  demoMode: boolean;
  hederaNetwork: "testnet";
  paymentAsset: "USDC" | "HBAR";
  ledgerAddress: string | null;
  /** The Hedera token id of the payment asset (USDC), for sending funds to a buyer agent. */
  usdcTokenId?: string;
  /** Added by the proof-of-work build (all optional so older servers still type-check). */
  zeroG?: { enabled: boolean; network: "testnet" | "mainnet"; model: string };
  namera?: { enabled: boolean };
  escrow?: { address: string | null; token: string | null; chainId: string };
  /** Public Sepolia RPC the browser uses to read ENS records directly. */
  sepoliaRpcUrl: string;
  /** Optional ENS Universal Resolver override for Sepolia (ENSv2). */
  ensUniversalResolver: string | null;
}

export interface PersonPublic {
  id: string;
  handle: string;
  mode: HumanMode;
  /** First 10 hex chars of the public provider key. */
  providerKeyShort: string;
  credentialExpired: boolean;
}

export interface AgentSummary {
  key: string; // namehash, 0x-prefixed
  ensName: string;
  label: string;
  kind: AgentKind;
  taskType: TaskType | null;
  description: string;
  ownerHandle: string;
  providerKeyShort: string;
  hederaAccountId: string;
  evmAddress: string;
  endpoint: string | null;
  basePrice: string;
  price: string;
  score: string;
  votes: number;
  hiresTotal: number;
  hiresCounted: number;
  createdAt: string;
  /** Hosted here only: the kind of model it thinks on. */
  modelType?: "text" | "image" | "decision" | "embedding" | "video";
  /** True for an agent found on-chain that another server hosts (no local settings, hire only). */
  remote?: boolean;
  /** Remote agents only: whether its x402 endpoint answered the last probe. */
  endpointStatus?: "online" | "offline" | "private" | "unknown";
}

export interface HireView {
  id: string;
  agentEnsName: string;
  buyerAgentEnsName: string;
  buyerHandle: string;
  quotedPrice: string;
  paidAmount: string | null;
  paymentTxId: string | null;
  paymentUrl: string | null;
  rating: number | null;
  status: HireStatus;
  reason: Reason | null;
  counted: boolean | null;
  ledgerTxHash: string | null;
  ledgerUrl: string | null;
  ensTxHash: string | null;
  ensUrl: string | null;
  parentHireId: string | null;
  createdAt: string;
}

export type HireStatus =
  | "delivered" // task done and paid (payment tx known or pending)
  | "rated" // rating received, waiting for the ledger write
  | "recorded" // on the ledger
  | "payment_not_verified"
  | "failed";

export interface AgentDetail extends AgentSummary {
  hires: HireView[];
  ensAppUrl: string;
  hederaAccountUrl: string;
  /** All agents owned by the same provider (dropping a bad agent cannot hide its history). */
  siblingAgents: AgentSummary[];
}

/** GET /api/me */
export interface MeResponse {
  person: PersonPublic | null;
  buyerAgent: (AgentSummary & { usdcBalance: string; hbarBalance: string; budgetRemaining: string }) | null;
  agents: AgentSummary[];
  /** Hires paid by my buyer agent, newest first. */
  hires: HireView[];
}

/** POST /api/auth/world/verify — body is the IDKit result, forwarded unchanged to World. */
export interface WorldVerifyRequest {
  handle: string;
  /** IDKit success payload, forwarded byte-for-byte. */
  proof: unknown;
}

/** GET /api/auth/world/rp-context — signed request context for the IDKit widget. */
export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** GET /api/stats */
export interface StatsResponse {
  agents: number;
  hires: number;
  counted: number;
}

/** POST /api/auth/dev — only when DEV_FAKE_PERSONS=true */
export interface DevLoginRequest {
  handle: string;
}

/** POST /api/agents */
export interface CreateAgentRequest {
  label: string;
  taskType: TaskType;
  basePrice: string; // e.g. "0.10"
  description?: string;
  /** Optional: this agent's own 0G Router key (sk-...). Stored encrypted on the server, never returned. */
  zgApiKey?: string;
  /** The 0G model family: text (default), image, decision, embedding or video. */
  modelType?: "text" | "image" | "decision" | "embedding" | "video";
  /** 0G Router model name. Required for non-text types; text defaults to the platform pick. */
  model?: string;
  /** The agent's own system prompt. */
  systemPrompt?: string;
}

export interface Consent {
  /** May the agent share this hire's data with a sub-agent? Default false. */
  forward: boolean;
  /** Max USDC the agent may spend on sub-hires for this hire. */
  subBudget: string;
  /** Text agents only: how many marketplace agents it may hire as assistants. 0 or missing turns this off. */
  maxAssistants?: number;
}

/** POST /api/hires */
export interface HireRequest {
  agent: string; // label or full ENS name
  input: string;
  translateTo?: "hi" | null;
  consent: Consent;
}

export interface SubHireOutcome {
  status: "done" | "blocked" | "skipped" | "failed";
  reason?: Reason | string;
  agentEnsName?: string;
  hireId?: string;
  /** Assistants only: USDC paid over x402. */
  amount?: string;
  paymentUrl?: string | null;
  /** Assistants only: images it made, as links or embedded data. Only ever filled from an image agent's own output. */
  images?: string[];
}

const IMAGE_SOURCE = /data:image\/[^\s"'()<>]+|https?:\/\/[^\s"'()<>]+/g;

/**
 * The images in an image agent's output, whatever way it wrapped them. Never run this on a text agent's answer: a poisoned
 * document could make the model write a link carrying the hirer's data, and showing it as an image would send that data out.
 */
export function extractImages(output: string): string[] {
  return [...new Set(output.match(IMAGE_SOURCE) ?? [])];
}

export interface HireResponse {
  hireId: string;
  result: string;
  quotedPrice: string;
  paymentTxId: string | null;
  paymentUrl: string | null;
  subHire: SubHireOutcome | null;
  /** One entry per assistant the agent tried to hire. */
  assistants?: SubHireOutcome[];
}

/** POST /api/hires/:id/rate */
export interface RateRequest {
  rating: number;
  /** Required when a buyer agent (not a web session) rates: EIP-191 signature over `${hireId}:${rating}`. */
  signature?: string;
}

export interface RateResponse {
  hire: HireView;
}

export type EventType =
  | "agent.created"
  | "hire.delivered"
  | "hire.rated"
  | "hire.recorded"
  | "hire.payment_not_verified"
  | "subhire.blocked"
  | "egress.blocked"
  | "ens.updated"
  | "arena.open.feedback"
  | "arena.open.done"
  | "arena.ethernals.progress"
  | "arena.ethernals.done"
  // proof-of-work tasks (docs/proof-of-work/PLAN.md)
  | "task.created"
  | "task.accepted"
  | "task.submitted"
  | "verify.status"
  | "verify.log"
  | "verify.result"
  | "task.settled"
  | "task.refunded"
  | "agent.born" // an agent was spun up: Hedera account, 0G brain key, ENS, ERC-8004 (data.step, data.message)
  | "inference.receipt" // a 0G Compute call finished (data.requestId, data.agentEnsName)
  | "spend.allowed" // Namera/guard confirmed a spend
  | "spend.blocked" // Namera/guard refused a spend (data.rule, data.reason)
  | "sandbox.step" // a lead agent thought, recruited or was refused (data.runId; metadata only)
  | "sandbox.done" // a run ended (data.runId, data.status)
  | "info";

/** One message on GET /api/events (Server-Sent Events, `data:` is this JSON). */
export interface EventMessage {
  id: number;
  type: EventType;
  at: string;
  data: Record<string, unknown> & {
    hireId?: string;
    agentEnsName?: string;
    reason?: Reason;
    counted?: boolean;
    score?: string;
    price?: string;
    paymentUrl?: string | null;
    ledgerUrl?: string | null;
    ensUrl?: string | null;
    txUrl?: string | null;
    buyerAgentEnsName?: string;
    message?: string;
  };
}

/** GET /api/arena/state */
export interface ArenaState {
  open: {
    ready: boolean;
    running: boolean;
    agentId: string | null;
    registry: string;
    reviewers: number;
    feedbackCount: number;
    average: string; // "3.00"
    gasUsed: string;
    costUsd: string; // "0.042" — what the same txs would cost on Base mainnet
    txUrls: string[];
    agentUrl: string | null;
    /** Fake reviewer wallets prepared and not yet used. */
    fakeWallets: number;
  };
  ethernals: {
    ready: boolean;
    running: boolean;
    agentEnsName: string | null;
    attackerHandle: string | null;
    attackerIsProvider: boolean;
    hires: number;
    paid: number;
    counted: number;
    notCounted: number;
    spentUsdc: string;
    score: string;
    price: string;
    paymentUrls: string[];
    /** Farm agents ready for the next run (for the current attacker). */
    farmSize: number;
  };
}

export interface ArenaRunRequest {
  /** Ethernals side only: run the farm as a different person instead of the provider (P1 toggle). */
  attacker?: "provider" | "other";
}

export interface ApiError {
  error: string;
  /** Plain-English hint for the UI. */
  hint?: string;
}
