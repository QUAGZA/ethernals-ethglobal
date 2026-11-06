/**
 * Runs the good and weak demo patches through the real pipeline WITHOUT the chain steps.
 * Expect: good = PASS, weak = FAIL. Mode follows VERIFIER_MODE (use `VERIFIER_MODE=local` if Docker is not running).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { loadConfig } from "../src/config";
import { Store } from "../src/store";
import { runJob } from "../src/pipeline";
import { loadDemo, prepareDemoRepo } from "../src/demo";
import { keccakUtf8, testsHash } from "../src/hashing";
import type { VerifyJob, VerifyRequest } from "@ethernals/shared";

const cfg = loadConfig();
const demo = loadDemo();
const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "ev-selftest-")));
const account = privateKeyToAccount(cfg.privateKey ?? generatePrivateKey());
const th = testsHash(demo.bundle);
store.putTests("selftest", demo.bundle);

async function attempt(name: string, patch: string, expectPass: boolean) {
  const jobId = `${name}-${Date.now()}`;
  const req: VerifyRequest = {
    taskId: name, chainTaskId: "0", repoUrl: "https://github.com/example/demo", baseCommit: "0".repeat(40),
    patch, testsId: "selftest", testsHash: th,
  };
  const job: VerifyJob = {
    jobId, taskId: name, chainTaskId: "0", status: "queued", createdAt: new Date().toISOString(), startedAt: null,
    finishedAt: null, result: null, resultHash: null, resultUrl: null, settleTxHash: null, erc8004TxHash: null, error: null, logTail: [],
  };
  store.putJob(job);
  const done = await runJob(
    { store, account, chain: null, mode: cfg.mode, image: cfg.image, timeoutSeconds: cfg.timeoutSeconds, publicUrl: "http://localhost", emit: () => undefined, prepareRepo: prepareDemoRepo },
    jobId,
    req,
  );
  const ok = (done.status === "passed") === expectPass;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${done.status.toUpperCase()} (expected ${expectPass ? "PASS" : "FAIL"}) patch ${keccakUtf8(patch).slice(0, 10)}`);
  if (done.error) console.log("     error:", done.error);
  return ok;
}

const results = [await attempt("good", demo.good, true), await attempt("weak", demo.weak, false)];
console.log(`mode=${cfg.mode}`);
process.exit(results.every(Boolean) ? 0 : 1);
