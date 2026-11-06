/**
 * Validation receipts and per-category capability records (Agent Economy plan §5.3, §5.4, §8).
 *
 * The receipt is a compact, deterministic projection of the verifier's signed `VerificationResult`. It carries only
 * what is needed to check the outcome (hashes, counts, status), never raw inputs, outputs or hidden tests.
 *
 * Integrity chain (what `verifyReceiptIntegrity` checks):
 *   1. receipt JSON in the database  --canonicalize (RFC 8785)--> keccak256  ==  receipt_hash stored in the database
 *   2. receipt.result_hash (keccak256 of the signed VerificationResult)       ==  TaskEscrow.getTask(id).resultHash on-chain
 * A match proves the committed receipt was not altered. It does not prove the validator itself is correct:
 * validator identity (the on-chain `validator` address) and reproducibility are separate controls.
 */
import { keccak256, toBytes } from "viem";
import { canonicalJson, type Hex, type VerificationResult } from "./tasks";

export type TaskCategory = "code-fix" | "data-extraction" | "research" | "api-task";

export interface ValidationReceipt {
  task_id: string;
  chain_task_id: string;
  agent_id: string;
  category: TaskCategory;
  validator_id: string;
  validator_version: string;
  validator_address: Hex;
  spec_hash: Hex;
  input_hash: Hex;
  output_hash: Hex;
  tests_hash: Hex;
  /** keccak256 of the signed VerificationResult: this is the value anchored on-chain by TaskEscrow.settle. */
  result_hash: Hex;
  tests_total: number;
  tests_passed: number;
  execution_status: "completed" | "failed" | "timeout";
  validation_status: "passed" | "failed";
  /** 0-100, integer: round(100 * tests_passed / tests_total). */
  score: number;
  /** Unix seconds. */
  timestamp: number;
}

/**
 * RFC 8785 (JCS) for the value space receipts use: objects, arrays, strings, booleans, null and finite numbers.
 * Keys sort by UTF-16 code unit and numbers serialize like ECMAScript, which is exactly what `canonicalJson` does.
 */
export function canonicalizeReceipt(receipt: ValidationReceipt): string {
  for (const [k, v] of Object.entries(receipt)) {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`receipt.${k} is not a finite number`);
    if (typeof v === "number" && !Number.isInteger(v)) throw new Error(`receipt.${k} must be an integer`);
  }
  return canonicalJson(receipt);
}

export function hashReceipt(receipt: ValidationReceipt): Hex {
  return keccak256(toBytes(canonicalizeReceipt(receipt)));
}

export const VALIDATOR_ID = "code-validator-v1";
export const VALIDATOR_VERSION = "1.0.0";

export interface ReceiptContext {
  agentId: string;
  specHash: Hex;
  inputHash: Hex;
  category?: TaskCategory;
  validatorId?: string;
  validatorVersion?: string;
}

/** Project a signed VerificationResult into a receipt. `resultHash` must be keccak256(canonicalJson(result sans signature)). */
export function receiptFromResult(result: VerificationResult, resultHash: Hex, ctx: ReceiptContext): ValidationReceipt {
  const total = result.testsPassed + result.testsFailed + result.testsErrored;
  const executionStatus: ValidationReceipt["execution_status"] =
    result.failureReason === "timeout" ? "timeout" : result.failureReason === "patch_did_not_apply" ? "failed" : "completed";
  return {
    task_id: result.taskId,
    chain_task_id: result.chainTaskId,
    agent_id: ctx.agentId,
    category: ctx.category ?? "code-fix",
    validator_id: ctx.validatorId ?? VALIDATOR_ID,
    validator_version: ctx.validatorVersion ?? VALIDATOR_VERSION,
    validator_address: result.verifier,
    spec_hash: ctx.specHash,
    input_hash: ctx.inputHash,
    output_hash: result.patchHash,
    tests_hash: result.testsHash,
    result_hash: resultHash,
    tests_total: total,
    tests_passed: result.testsPassed,
    execution_status: executionStatus,
    validation_status: result.passed ? "passed" : "failed",
    score: total === 0 ? 0 : Math.round((100 * result.testsPassed) / total),
    timestamp: Math.floor(new Date(result.finishedAt).getTime() / 1000),
  };
}

export type ReceiptCheckStatus = "verified" | "invalid" | "unanchored";

export interface ReceiptCheck {
  status: ReceiptCheckStatus;
  /** Hash recomputed from the stored receipt. */
  recomputedHash: Hex;
  storedHash: Hex;
  /** receipt.result_hash vs the value on-chain; null when the chain could not be queried or the task is unsettled. */
  anchoredHash: Hex | null;
  reasons: string[];
}

/**
 * Steps 1-7 of plan §5.4. `anchoredHash` is TaskEscrow.getTask(chainTaskId).resultHash (zero hash = not settled yet).
 */
export function verifyReceiptIntegrity(
  receipt: ValidationReceipt,
  storedHash: Hex,
  anchoredHash: Hex | null,
): ReceiptCheck {
  const reasons: string[] = [];
  const recomputedHash = hashReceipt(receipt);
  if (recomputedHash.toLowerCase() !== storedHash.toLowerCase()) reasons.push("database hash does not match the receipt");
  const zero = "0x" + "0".repeat(64);
  const anchored = anchoredHash && anchoredHash !== zero ? anchoredHash : null;
  if (anchored && anchored.toLowerCase() !== receipt.result_hash.toLowerCase()) {
    reasons.push("on-chain commitment does not match the receipt");
  }
  const status: ReceiptCheckStatus = reasons.length ? "invalid" : anchored ? "verified" : "unanchored";
  return { status, recomputedHash, storedHash, anchoredHash: anchored, reasons };
}

// ---------------------------------------------------------------- capability records (plan §8)

export interface CapabilityRecord {
  category: TaskCategory;
  verified: number;
  passed: number;
  failed: number;
  /** passed / verified, 0-100 integer; 0 when nothing is verified. */
  successRatePct: number;
  /** Mean receipt score, 0-100. */
  avgScore: number;
}

/** Per-category track record derived only from validation receipts. Never a single universal score. */
export function capabilitiesFromReceipts(receipts: ValidationReceipt[]): CapabilityRecord[] {
  const by = new Map<TaskCategory, ValidationReceipt[]>();
  for (const r of receipts) by.set(r.category, [...(by.get(r.category) ?? []), r]);
  return [...by.entries()]
    .map(([category, rs]) => {
      const passed = rs.filter((r) => r.validation_status === "passed").length;
      return {
        category,
        verified: rs.length,
        passed,
        failed: rs.length - passed,
        successRatePct: Math.round((100 * passed) / rs.length),
        avgScore: Math.round(rs.reduce((s, r) => s + r.score, 0) / rs.length),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** Capability credential: unlocked after enough verified passes in a category (a new model version starts at zero). */
export const CREDENTIAL_TIERS = [
  { tier: "bronze", minPassed: 1, minSuccessPct: 50 },
  { tier: "silver", minPassed: 5, minSuccessPct: 70 },
  { tier: "gold", minPassed: 15, minSuccessPct: 85 },
] as const;

export function credentialFor(record: CapabilityRecord): (typeof CREDENTIAL_TIERS)[number]["tier"] | null {
  let best: (typeof CREDENTIAL_TIERS)[number]["tier"] | null = null;
  for (const t of CREDENTIAL_TIERS) {
    if (record.passed >= t.minPassed && record.successRatePct >= t.minSuccessPct) best = t.tier;
  }
  return best;
}
