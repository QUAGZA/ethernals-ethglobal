/**
 * FROZEN INTERFACE for proof-of-work tasks (docs/proof-of-work/PLAN.md).
 *
 * Shared by:
 *   - apps/verifier (Dev A): the sandbox verifier's HTTP API
 *   - apps/server + apps/web (Dev B): tasks, coding agents, UI
 *
 * Rules: do not rename or remove anything here on a feature branch. Additive changes (new optional fields,
 * new types) are fine if you tell the other dev. Breaking changes go to main in a tiny PR both devs agree on.
 * All amounts are decimal strings in tUSDC (6 decimals), e.g. "2.000000". All hashes are 0x-prefixed keccak256.
 */

export type Hex = `0x${string}`;

// ---------------------------------------------------------------- escrow (on-chain)

/** Index = ITaskEscrow.Status enum value. */
export const ESCROW_STATUS = ["None", "Open", "Accepted", "Submitted", "Passed", "Failed", "Refunded"] as const;
export type EscrowStatus = (typeof ESCROW_STATUS)[number];

/** Chain that holds the escrow, tUSDC, ENS, ERC-8004 and the Namera accounts (CAIP-2). Payments (x402) and the HireLedger stay on Hedera testnet. */
export const ESCROW_CHAIN_ID = "eip155:11155111" as const;

/** Minimal ABI for tUSDC (MockUSDC on Ethereum Sepolia). Standard ERC-20 plus an open, capped faucet `mint`. */
export const mockUsdcAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Max tUSDC per mint() call (atomic, 6 decimals) = 1,000 tUSDC. */
export const MOCK_USDC_MINT_CAP = 1_000_000_000n;

// ---------------------------------------------------------------- task spec (public, hashed into specHash)

/** The public part of a task. specHash = keccak256(utf8(canonicalJson(spec))). Never contains hidden tests. */
export interface TaskSpec {
  version: 1;
  kind: "code-fix";
  language: "python";
  title: string;
  /** https URL of a public git repo (GitHub). */
  repoUrl: string;
  /** Full 40-char commit SHA the patch must apply to. */
  baseCommit: string;
  /** The issue in plain words: what is wrong and what "fixed" means. */
  issue: string;
  /** Command the verifier runs inside the sandbox. Default "pytest -q". */
  testCommand?: string;
}

/** Hidden tests, uploaded only to the verifier. testsHash = keccak256(utf8(canonicalJson(bundle))). */
export interface HiddenTestsBundle {
  /** Paths are relative to the repo root, e.g. "tests_hidden/test_edge_cases.py". */
  files: { path: string; content: string }[];
}

/**
 * Canonical JSON used for every hash in this file: object keys sorted recursively, no whitespace,
 * arrays kept in order. For HiddenTestsBundle, sort `files` by `path` before hashing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------- verifier HTTP API (Dev A implements)
// Base URL: VERIFIER_URL (default http://127.0.0.1:4100). Every request except GET /health and
// GET /results/:jobId.json must send header `x-verifier-token: <VERIFIER_TOKEN>`.

/** GET /health */
export interface VerifierHealth {
  ok: boolean;
  mode: "docker" | "local";
  dockerAvailable: boolean;
  image: string;
  /** Validator address (the key allowed to call TaskEscrow.settle and ERC-8004 validationResponse; both on Sepolia). */
  validator: Hex;
  escrow: Hex | null;
  /** Always ESCROW_CHAIN_ID. */
  escrowChain: typeof ESCROW_CHAIN_ID;
  /** x402-paid verification (POST /verify-paid, USDC on Hedera testnet). null when not enabled. */
  paidVerify: { feeUsdc: string; payTo: string; network: "hedera:testnet" } | null;
}

/** POST /tests  body: HiddenTestsBundle  →  UploadTestsResponse. The verifier never returns the contents. */
export interface UploadTestsResponse {
  testsId: string;
  testsHash: Hex;
}

/** POST /verify  →  202 VerifyAccepted */
export interface VerifyRequest {
  /** Server-side task id (Dev B's database). */
  taskId: string;
  /** On-chain TaskEscrow task id, as a decimal string. */
  chainTaskId: string;
  repoUrl: string;
  baseCommit: string;
  /** Unified diff (output of `git diff`) that applies to baseCommit with `git apply`. */
  patch: string;
  testsId: string;
  /** Must equal the testsHash committed on-chain; the verifier re-checks it. */
  testsHash: Hex;
  testCommand?: string;
  /** If set, the verifier answers this ERC-8004 validation request on Sepolia after the run. */
  erc8004RequestHash?: Hex;
  /** ERC-8004 agentId of the specialist (decimal string), for the validation response. */
  specialistAgentId?: string;
}

export interface VerifyAccepted {
  jobId: string;
}

export type VerifyJobStatus = "queued" | "running" | "passed" | "failed" | "error";

/** The signed evidence. resultHash = keccak256(utf8(canonicalJson(result without `signature`))). */
export interface VerificationResult {
  version: 1;
  jobId: string;
  taskId: string;
  chainTaskId: string;
  repoUrl: string;
  baseCommit: string;
  patchHash: Hex;
  testsHash: Hex;
  passed: boolean;
  testsPassed: number;
  testsFailed: number;
  testsErrored: number;
  /** "patch_did_not_apply" | "timeout" | "tests_failed" | null (null when passed). */
  failureReason: string | null;
  durationMs: number;
  /** keccak256 of the full raw log text. */
  logsHash: Hex;
  isolation: "docker" | "none";
  image: string;
  startedAt: string;
  finishedAt: string;
  verifier: Hex;
  /** EIP-191 signature by `verifier` over the 32-byte resultHash (viem signMessage({ message: { raw: resultHash } })). */
  signature: Hex;
}

/** GET /jobs/:jobId */
export interface VerifyJob {
  jobId: string;
  taskId: string;
  chainTaskId: string;
  status: VerifyJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: VerificationResult | null;
  resultHash: Hex | null;
  /** Public URL of the signed result JSON: `${VERIFIER_PUBLIC_URL}/results/<jobId>.json` (also the on-chain resultURI). */
  resultUrl: string | null;
  /** TaskEscrow.settle transaction on Ethereum Sepolia. */
  settleTxHash: Hex | null;
  /** ERC-8004 validationResponse transaction on Sepolia. */
  erc8004TxHash: Hex | null;
  error: string | null;
  /** Last ~200 log lines (task data stays inside the sandbox; logs are test output only). */
  logTail: string[];
}

/** GET /jobs/:jobId/events — Server-Sent Events; each `data:` is one VerifierEvent JSON. */
export type VerifierEvent =
  | { jobId: string; at: string; type: "status"; status: VerifyJobStatus }
  | { jobId: string; at: string; type: "log"; line: string }
  | { jobId: string; at: string; type: "result"; result: VerificationResult; resultHash: Hex; resultUrl: string }
  | { jobId: string; at: string; type: "settled"; settleTxHash: Hex; passed: boolean }
  | { jobId: string; at: string; type: "erc8004"; txHash: Hex }
  | { jobId: string; at: string; type: "error"; message: string };

// ---------------------------------------------------------------- agent brain: 0G Compute Router (Dev B implements)
// Every agent's thinking (code fixes, summaries, judging) runs on the 0G Compute Router: an OpenAI-compatible API
// (POST {ZG_ROUTER_BASE_URL}/chat/completions, Authorization: Bearer sk-...). Each agent gets its OWN sk- key,
// created with the management key (mk-), when it is spun up. Agents "pay for themselves": earnings credit the brain.

export interface InferenceReceipt {
  agentEnsName: string;
  /** "code-fix" | "summarize" | "translate" | "judge" | "birth" */
  purpose: string;
  taskId: string | null;
  model: string;
  /** The Router's response id (OpenAI-style "chatcmpl-..."): the request id 0G asks for in submissions. */
  requestId: string;
  /** 0G provider address that served the call, if the Router exposes it (response header or /v1/providers). */
  provider: string | null;
  promptTokens: number;
  completionTokens: number;
  /** Estimated cost in neuron (1e18 neuron = 1 0G): tokens x the model's /v1/models pricing. */
  costNeuron: string;
  at: string;
}

export interface AgentBrainView {
  backend: "0g-router" | "anthropic" | "offline";
  network: "testnet" | "mainnet" | null;
  model: string;
  /** Label of the per-agent 0G API key (the key itself is never exposed). */
  keyLabel: string | null;
  /** Spendable inference credit in neuron. */
  creditNeuron: string;
  spentNeuron: string;
  /** USDC this agent has earned (attempt fees + bounties), decimal string. */
  earnedUsdc: string;
  /** Part of creditNeuron that came from earnings (the rest is the seed credit). */
  creditedFromEarningsNeuron: string;
  /** "dormant" = credit below the minimum for one task; the agent refuses new hires until it earns. */
  status: "awake" | "dormant";
  receipts: number;
  lastRequestId: string | null;
}

// ---------------------------------------------------------------- spending controls: Namera (Dev A implements the Namera guard)
// A client agent never holds the owner's key. Bounties are funded through a SpendGuard:
//   - "namera": the person's Namera smart account on Sepolia; the agent only has a SESSION KEY whose on-chain policy
//     limits which contracts it may call, how much tUSDC it may move, how often, and until when.
//   - "direct": fallback - the agent's own key with limits checked by our server only (weaker; shown as such in the UI).

export type SpendGuardKind = "namera" | "direct";

export interface SpendPolicyView {
  guard: SpendGuardKind;
  /** The account that sends the transactions (becomes TaskEscrow task.client). */
  accountAddress: Hex;
  chainId: typeof ESCROW_CHAIN_ID;
  sessionKeyId: string | null;
  status: "active" | "revoked" | "expired" | "unknown";
  /** Contracts the session key may call (tUSDC + TaskEscrow). */
  allowedContracts: Hex[];
  /** Token cap, decimal tUSDC; null if the policy has none. */
  tokenAllowanceUsdc: string | null;
  /** Human-readable rate limit, e.g. "5 per hour"; null if none. */
  rateLimit: string | null;
  validUntil: string | null;
  source: "namera-api" | "local";
}

export interface SpendCall {
  to: Hex;
  data: Hex;
  /** Native value in wei, decimal string. Default "0". */
  value?: string;
}

export interface SpendRequest {
  chainId: typeof ESCROW_CHAIN_ID;
  calls: SpendCall[];
  /** e.g. "fund task 12", for audit logs and the UI. */
  purpose: string;
  /** tUSDC (6 decimals, decimal string) this request is meant to move; used for display and the direct guard's own limit. */
  amountUsdc: string;
}

/** execute() never throws for policy blocks: a block is a normal, displayable outcome. */
export type SpendResult =
  | { status: "confirmed"; guard: SpendGuardKind; txHash: Hex; submissionId: string | null }
  | { status: "blocked"; guard: SpendGuardKind; reason: string; rule: string | null }
  | { status: "failed"; guard: SpendGuardKind; error: string };

export interface SpendGuard {
  readonly kind: SpendGuardKind;
  address(): Promise<Hex>;
  policy(): Promise<SpendPolicyView>;
  execute(request: SpendRequest): Promise<SpendResult>;
}

export interface SpendEventView {
  at: string;
  guard: SpendGuardKind;
  purpose: string;
  amountUsdc: string;
  status: "confirmed" | "blocked" | "failed";
  rule: string | null;
  reason: string | null;
  txUrl: string | null;
}

/** POST /api/me/spend/connect - the person pastes what the Namera dashboard gave them. */
export interface ConnectNameraRequest {
  apiKey: string;
  walletId: string;
  sessionKeyId: string;
}

/** GET /api/me/spend */
export interface SpendStateView {
  guard: SpendGuardKind;
  policy: SpendPolicyView | null;
  recent: SpendEventView[];
}

/** POST /api/me/spend/try-overspend (demo mode only): tries to fund a bounty above the policy cap and returns what happened. */
export interface TryOverspendResponse {
  event: SpendEventView;
}

// ---------------------------------------------------------------- server <-> web API (Dev B implements)

export type TaskStatus =
  | "creating" // server is funding + creating on-chain
  | "open"
  | "accepted"
  | "submitted"
  | "verifying"
  | "passed"
  | "failed"
  | "refunded"
  | "error";

export interface TaskLinks {
  createTx: string | null;
  acceptTx: string | null;
  submitTx: string | null;
  settleTx: string | null;
  refundTx: string | null;
  x402Payment: string | null;
  erc8004Request: string | null;
  erc8004Response: string | null;
  hireLedger: string | null;
  result: string | null;
}

export interface TaskView {
  id: string;
  chainTaskId: string | null;
  spec: TaskSpec;
  specHash: Hex | null;
  testsHash: Hex | null;
  bounty: string;
  deadline: string; // ISO
  status: TaskStatus;
  clientHandle: string;
  clientAgentEnsName: string;
  specialistEnsName: string | null;
  patch: string | null;
  patchHash: Hex | null;
  explanation: string | null;
  verifyJobId: string | null;
  result: VerificationResult | null;
  hireId: string | null;
  /** Every 0G Compute call made for this task (code generation by the specialist). */
  inference: InferenceReceipt[];
  /** Every spend attempt for this task (bounty funding), including those Namera blocked. */
  spend: SpendEventView[];
  links: TaskLinks;
  error: string | null;
  createdAt: string;
}

/** POST /api/tasks */
export interface CreateTaskRequest {
  /** Use a built-in demo task (repo, commit, issue and hidden tests filled in by the server). */
  template?: "slugify";
  spec?: Omit<TaskSpec, "version" | "kind" | "language">;
  hiddenTests?: HiddenTestsBundle;
  bounty: string; // e.g. "2.00"
  deadlineMinutes: number; // e.g. 30
  /** ENS name of the only specialist allowed to accept, or omit for an open task. */
  specialist?: string;
}

/** POST /api/tasks/:id/hire — the client's buyer agent pays the specialist's x402 endpoint to work on the task. */
export interface HireForTaskRequest {
  specialist: string; // ENS name
}

/** POST /api/duels — the same demo task given to two specialists at once (one strong, one weak). */
export interface CreateDuelRequest {
  template: "slugify";
  specialists: [string, string];
  bounty: string;
}

export interface DuelView {
  id: string;
  tasks: [TaskView, TaskView];
}
