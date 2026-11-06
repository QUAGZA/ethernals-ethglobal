import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrivateKeyAccount } from "viem";
import {
  canonicalJson,
  receiptFromResult,
  hashReceipt,
  type Hex,
  type VerificationResult,
  type VerifyJob,
  type VerifyRequest,
  type VerifierEvent,
} from "@ethernals/shared";
import type { ChainClient } from "./chain";
import { isSafeRelativePath, keccakUtf8 } from "./hashing";
import { grade, parseJunit, type Grade } from "./junit";
import { runTests, type RunOutcome } from "./runner";
import type { Store } from "./store";

export interface PipelineDeps {
  store: Store;
  account: PrivateKeyAccount;
  /** null = no chain steps (selftest, development without a deployed escrow). */
  chain: ChainClient | null;
  mode: "docker" | "local";
  image: string;
  timeoutSeconds: number;
  publicUrl: string;
  emit: (e: VerifierEvent) => void;
  /** Override for tests: puts the repo at base commit into `repoDir`. */
  prepareRepo?: (repoDir: string, req: VerifyRequest, log: (l: string) => void) => Promise<void>;
  /** Override for tests. */
  run?: typeof runTests;
}

export const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;
const SHA = /^[0-9a-f]{40}$/;

function git(cwd: string, args: string[], input?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn("git", args, { cwd, windowsHide: true });
    let out = "";
    c.stdout.on("data", (b) => (out += b));
    c.stderr.on("data", (b) => (out += b));
    c.on("error", reject);
    c.on("close", (code) => resolve({ code: code ?? 1, out }));
    if (input !== undefined) c.stdin.end(input);
  });
}

export async function cloneRepo(repoDir: string, req: VerifyRequest, log: (l: string) => void): Promise<void> {
  if (!GITHUB_REPO.test(req.repoUrl)) throw new Error("only https://github.com/ repositories are accepted");
  if (!SHA.test(req.baseCommit)) throw new Error("baseCommit must be a full 40-character SHA");
  const parent = path.dirname(repoDir);
  const c = await git(parent, ["-c", "core.autocrlf=false", "clone", "--quiet", req.repoUrl, path.basename(repoDir)]);
  if (c.code !== 0) throw new Error(`clone failed: ${c.out.slice(0, 300)}`);
  const k = await git(repoDir, ["-c", "advice.detachedHead=false", "checkout", req.baseCommit]);
  if (k.code !== 0) throw new Error(`checkout failed: ${k.out.slice(0, 300)}`);
  log(`checked out ${req.baseCommit.slice(0, 8)}`);
}

async function applyPatch(repoDir: string, patch: string, log: (l: string) => void): Promise<boolean> {
  const f = path.join(path.dirname(repoDir), "submitted.patch");
  fs.writeFileSync(f, patch);
  const check = await git(repoDir, ["apply", "--check", f]);
  if (check.code !== 0) {
    log(`patch does not apply: ${check.out.split("\n")[0]}`);
    return false;
  }
  const ap = await git(repoDir, ["apply", f]);
  return ap.code === 0;
}

function nowIso() {
  return new Date().toISOString();
}

export async function runJob(deps: PipelineDeps, jobId: string, req: VerifyRequest): Promise<VerifyJob> {
  const { store } = deps;
  let job = store.getJob(jobId)!;
  const save = (patch: Partial<VerifyJob>) => {
    job = { ...job, ...patch };
    store.putJob(job);
  };
  const emit = (e: Omit<VerifierEvent, "jobId" | "at"> & Record<string, unknown>) => {
    const ev = { jobId, at: nowIso(), ...e } as VerifierEvent;
    store.appendEvent(jobId, ev);
    deps.emit(ev);
  };
  const tail: string[] = [];
  const log = (line: string) => {
    tail.push(line);
    if (tail.length > 200) tail.shift();
    job = { ...job, logTail: [...tail] };
    emit({ type: "log", line });
  };
  const fail = (message: string) => {
    save({ status: "error", error: message, finishedAt: nowIso(), logTail: [...tail] });
    emit({ type: "error", message });
    return job;
  };

  const work = path.join(os.tmpdir(), "ethernals-verify", jobId);
  try {
    save({ status: "running", startedAt: nowIso() });
    emit({ type: "status", status: "running" });
    const startedAt = nowIso();
    const t0 = Date.now();

    const bundle = store.getTests(req.testsId);
    if (!bundle) return fail("unknown testsId");
    const { testsHash: computed } = await import("./hashing").then((m) => ({ testsHash: m.testsHash(bundle) }));
    if (computed !== req.testsHash) return fail("stored tests do not match the requested testsHash");

    const patchHash = keccakUtf8(req.patch);
    let specHash: Hex = ("0x" + "0".repeat(64)) as Hex;
    if (deps.chain) {
      log("checking the task commitments on-chain");
      const t = await deps.chain.getTask(BigInt(req.chainTaskId));
      if (t.status !== 3) return fail(`task is not in Submitted state (status ${t.status})`);
      if (t.patchHash !== patchHash) return fail("patch does not match the hash the specialist committed on-chain");
      if (t.testsHash !== req.testsHash) return fail("testsHash does not match the on-chain commitment");
      specHash = t.specHash;
    }

    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const repoDir = path.join(work, "repo");
    const outDir = path.join(work, "out");
    await (deps.prepareRepo ?? cloneRepo)(repoDir, req, log);

    let g: Grade;
    let outcome: RunOutcome = { exitCode: null, timedOut: false, junitXml: null };
    const applied = await applyPatch(repoDir, req.patch, log);
    if (!applied) {
      g = { passed: false, testsPassed: 0, testsFailed: 0, testsErrored: 0, failureReason: "patch_did_not_apply" };
    } else {
      for (const f of bundle.files) {
        if (!isSafeRelativePath(f.path)) return fail("unsafe path in hidden tests");
        const dest = path.join(repoDir, ...f.path.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content);
      }
      log(`running hidden tests (${deps.mode}${deps.mode === "local" ? ", NOT isolated" : ""})`);
      outcome = await (deps.run ?? runTests)({
        mode: deps.mode,
        image: deps.image,
        repoDir,
        outDir,
        jobId,
        testCommand: req.testCommand ?? "pytest -q",
        timeoutSeconds: deps.timeoutSeconds,
        onLine: log,
      });
      g = grade(outcome.exitCode, outcome.timedOut, outcome.junitXml ? parseJunit(outcome.junitXml) : null);
    }

    const finishedAt = nowIso();
    const unsigned: Omit<VerificationResult, "signature"> = {
      version: 1,
      jobId,
      taskId: req.taskId,
      chainTaskId: req.chainTaskId,
      repoUrl: req.repoUrl,
      baseCommit: req.baseCommit,
      patchHash,
      testsHash: req.testsHash,
      passed: g.passed,
      testsPassed: g.testsPassed,
      testsFailed: g.testsFailed,
      testsErrored: g.testsErrored,
      failureReason: g.failureReason,
      durationMs: Date.now() - t0,
      logsHash: keccakUtf8(tail.join("\n")),
      isolation: deps.mode === "docker" ? "docker" : "none",
      image: deps.image,
      startedAt,
      finishedAt,
      verifier: deps.account.address,
    };
    const resultHash = keccakUtf8(canonicalJson(unsigned));
    const signature = await deps.account.signMessage({ message: { raw: resultHash } });
    const result: VerificationResult = { ...unsigned, signature };
    store.putResult(jobId, result);
    const resultUrl = `${deps.publicUrl}/results/${jobId}.json`;

    const receipt = receiptFromResult(result, resultHash, {
      agentId: req.specialistAgentId ?? "unknown",
      specHash,
      inputHash: keccakUtf8(`${req.repoUrl}@${req.baseCommit}`),
    });
    store.putReceipt(jobId, { receipt, receiptHash: hashReceipt(receipt) });

    save({ result, resultHash, resultUrl, status: g.passed ? "passed" : "failed", finishedAt, logTail: [...tail] });
    emit({ type: "result", result, resultHash, resultUrl });
    emit({ type: "status", status: g.passed ? "passed" : "failed" });

    if (deps.chain) {
      try {
        const settleTxHash = await deps.chain.settle(BigInt(req.chainTaskId), g.passed, resultHash, resultUrl);
        save({ settleTxHash });
        emit({ type: "settled", settleTxHash, passed: g.passed });
        if (req.erc8004RequestHash) {
          const txHash = await deps.chain.validationResponse(req.erc8004RequestHash, g.passed ? 100 : 0, resultUrl, resultHash);
          save({ erc8004TxHash: txHash });
          emit({ type: "erc8004", txHash });
        }
      } catch (e) {
        // Keep the signed result; surface the settlement failure.
        const message = `settlement failed: ${(e as Error).message}`;
        save({ error: message });
        emit({ type: "error", message });
      }
    }
    return job;
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
