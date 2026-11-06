/**
 * Verified work: submits an agent's output to the independent sandbox verifier (apps/verifier), stores the
 * validation receipt in the database, and re-checks it against the on-chain commitment on every read.
 * The agent never decides its own verdict: the pass/fail, the score and the receipt all come from the verifier.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import {
  capabilitiesFromReceipts,
  credentialFor,
  sepoliaTxUrl,
  taskEscrowAbi,
  verifyReceiptIntegrity,
  type CapabilitiesView,
  type Hex,
  type HiddenTestsBundle,
  type ProofView,
  type SubcontractResponse,
  type ValidationReceipt,
  type VerifyJob,
} from "@ethernals/shared";
import { config, ROOT_DIR } from "./config";
import { randomId } from "./crypto";
import { getProof, insertProof, listProofs, listProofsForAgent, setProofParent, type ProofRow } from "./db";
import { AppError, badRequest, notFound } from "./errors";
import { emit } from "./events";

const DEMO_DIR = path.join(ROOT_DIR, "demo", "tasks", "slugify");
const DEMO_REPO_URL = "demo://slugify";
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function loadDemo(): { bundle: HiddenTestsBundle; good: string; weak: string } {
  const hidden = path.join(DEMO_DIR, "hidden_tests");
  if (!fs.existsSync(hidden)) throw new AppError(503, "The demo task files are missing.", "Expected demo/tasks/slugify in the repo.");
  const files: HiddenTestsBundle["files"] = [];
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const full = path.join(d, n);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (!n.endsWith(".pyc")) {
        files.push({ path: path.relative(hidden, full).split(path.sep).join("/"), content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(hidden);
  return {
    bundle: { files },
    good: fs.readFileSync(path.join(DEMO_DIR, "good.patch"), "utf8"),
    weak: fs.readFileSync(path.join(DEMO_DIR, "weak.patch"), "utf8"),
  };
}

async function vfetch<T>(p: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.proofs.verifierUrl}${p}`, {
      ...init,
      headers: { "content-type": "application/json", "x-verifier-token": config.proofs.verifierToken, ...(init?.headers ?? {}) },
    });
  } catch {
    throw new AppError(503, "The sandbox verifier is not reachable.", "Run pnpm verifier:setup, then pnpm verifier:dev (VERIFIER_MODE=local if Docker is off).");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new AppError(502, `Verifier error: ${body.error ?? res.status}`);
  return body as T;
}

async function waitForJob(jobId: string, timeoutMs = 180_000): Promise<VerifyJob> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const job = await vfetch<VerifyJob>(`/jobs/${jobId}`);
    const done = ["passed", "failed", "error"].includes(job.status);
    if (done && (job.status === "error" || !config.proofs.escrow || job.settleTxHash || job.error)) return job;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new AppError(504, "Verification timed out.");
}

/** Runs one patch through the independent validator and stores the receipt. */
async function validate(args: { agent: string; patchKind: "good" | "weak"; title: string }): Promise<ProofRow> {
  const demo = loadDemo();
  const patch = demo[args.patchKind];
  const up = await vfetch<{ testsId: string; testsHash: Hex }>("/tests", { method: "POST", body: JSON.stringify(demo.bundle) });
  const { jobId } = await vfetch<{ jobId: string }>("/verify", {
    method: "POST",
    body: JSON.stringify({
      taskId: randomId("task"),
      chainTaskId: "0",
      repoUrl: DEMO_REPO_URL,
      baseCommit: "0".repeat(40),
      patch,
      testsId: up.testsId,
      testsHash: up.testsHash,
      specialistAgentId: args.agent,
    }),
  });
  const job = await waitForJob(jobId);
  if (job.status === "error" || !job.result) throw new AppError(502, `Verification failed to run: ${job.error ?? "no result"}`);

  const stored = await vfetch<{ receipt: ValidationReceipt; receiptHash: Hex }>(`/receipts/${jobId}.json`);
  const row = insertProof({
    id: randomId("proof"),
    agent: args.agent,
    parent_proof_id: null,
    category: stored.receipt.category,
    title: args.title,
    job_id: jobId,
    chain_task_id: config.proofs.escrow && job.settleTxHash ? job.chainTaskId : null,
    patch_hash: job.result.patchHash,
    receipt_json: JSON.stringify(stored.receipt),
    receipt_hash: stored.receiptHash,
    validator_json: JSON.stringify({
      id: stored.receipt.validator_id,
      version: stored.receipt.validator_version,
      address: stored.receipt.validator_address,
      isolation: job.result.isolation,
    }),
    settlement_status: job.settleTxHash ? (job.result.passed ? "paid" : "refunded") : "none",
    settle_tx: job.settleTxHash,
    result_url: job.resultUrl,
    log_json: JSON.stringify(job.logTail),
  });
  emit("info", { message: `${args.agent}: ${row.title} validated ${stored.receipt.validation_status.toUpperCase()} (${stored.receipt.score}/100)` });
  return row;
}

async function anchoredHash(row: ProofRow): Promise<Hex | null> {
  if (!config.proofs.escrow || !row.chain_task_id) return null;
  try {
    const client = createPublicClient({ chain: sepolia, transport: http(config.sepolia.publicRpcUrl, { timeout: 15_000 }) });
    const t = await client.readContract({
      address: config.proofs.escrow,
      abi: taskEscrowAbi,
      functionName: "getTask",
      args: [BigInt(row.chain_task_id)],
    });
    return (t as { resultHash: Hex }).resultHash;
  } catch {
    return null;
  }
}

/**
 * Recomputes the receipt hash from the stored copy and compares it with the stored hash and, when the task was
 * settled on-chain, with TaskEscrow's commitment. `result_hash` inside the receipt is what settle() anchored.
 */
export async function proofView(row: ProofRow): Promise<ProofView> {
  const receipt = JSON.parse(row.receipt_json) as ValidationReceipt;
  return {
    id: row.id,
    agent: row.agent,
    parentProofId: row.parent_proof_id,
    category: receipt.category,
    title: row.title,
    patchHash: row.patch_hash as Hex,
    validator: JSON.parse(row.validator_json),
    receipt,
    receiptHash: row.receipt_hash as Hex,
    check: verifyReceiptIntegrity(receipt, row.receipt_hash as Hex, await anchoredHash(row)),
    settlement: {
      status: row.settlement_status,
      txHash: row.settle_tx as Hex | null,
      txUrl: row.settle_tx ? sepoliaTxUrl(row.settle_tx) : null,
    },
    payment: null,
    resultUrl: row.result_url,
    logTail: JSON.parse(row.log_json),
    createdAt: row.created_at,
  };
}

function cleanLabel(label: string | undefined, fallback: string): string {
  const v = (label ?? fallback).trim().toLowerCase();
  if (!LABEL.test(v)) throw badRequest("Agent names use lowercase letters, digits and hyphens.");
  return v;
}

export async function runDemoProof(patch: "good" | "weak", agent?: string): Promise<ProofView> {
  const row = await validate({ agent: cleanLabel(agent, patch === "good" ? "pixel" : "weak-pixel"), patchKind: patch, title: "Repair slugify()" });
  return proofView(row);
}

/** The prime agent buys a subtask; it only submits the full fix if the bought piece actually validated. */
export async function runSubcontract(agent: string, specialist: string, specialistPatch: "good" | "weak"): Promise<SubcontractResponse> {
  const prime = cleanLabel(agent, "pixel");
  const spec = cleanLabel(specialist, "tester");
  if (prime === spec) throw badRequest("An agent cannot subcontract to itself.");
  const sub = await validate({ agent: spec, patchKind: specialistPatch, title: `Subtask for ${prime}: normalise unicode` });
  const subPassed = (JSON.parse(sub.receipt_json) as ValidationReceipt).validation_status === "passed";
  const parent = await validate({
    agent: prime,
    patchKind: subPassed ? "good" : "weak",
    title: "Repair slugify() (incorporates subtask)",
  });
  setProofParent(sub.id, parent.id);
  const subView = await proofView({ ...sub, parent_proof_id: parent.id });
  return { parent: await proofView(parent), sub: subView };
}

export async function listProofViews(): Promise<ProofView[]> {
  return Promise.all(listProofs(50).map(proofView));
}

export async function getProofView(id: string): Promise<ProofView> {
  const row = getProof(id);
  if (!row) throw notFound("No such proof.");
  return proofView(row);
}

export function capabilitiesOf(agent: string): CapabilitiesView {
  const receipts = listProofsForAgent(agent).map((r) => JSON.parse(r.receipt_json) as ValidationReceipt);
  const records = capabilitiesFromReceipts(receipts).map((r) => ({ ...r, credential: credentialFor(r) }));
  return { agent, records, totalVerified: receipts.length };
}
