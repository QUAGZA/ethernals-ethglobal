import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, hashReceipt, type Hex, type VerificationResult } from "@ethernals/shared";
import { createApp } from "../src/app";
import type { ChainClient, OnChainTask } from "../src/chain";
import { loadDemo, prepareDemoRepo } from "../src/demo";
import { isSafeRelativePath, keccakUtf8, testsHash, validateBundle } from "../src/hashing";
import { grade, parseJunit } from "../src/junit";
import { dockerArgs, isSafeTestCommand } from "../src/runner";
import { Store } from "../src/store";

const hasPytest = spawnSync("pytest", ["--version"], { shell: true }).status === 0;

describe("hashing", () => {
  it("testsHash is order independent and matches canonicalJson", () => {
    const a = { files: [{ path: "b.py", content: "2" }, { path: "a.py", content: "1" }] };
    const b = { files: [a.files[1], a.files[0]] };
    expect(testsHash(a)).toBe(testsHash(b));
    expect(testsHash(a)).toBe(keccakUtf8(canonicalJson({ files: [{ content: "1", path: "a.py" }, { content: "2", path: "b.py" }] })));
  });
  it("rejects path traversal and oversized bundles", () => {
    for (const p of ["../x.py", "/etc/passwd", "a/../b", "C:/x", "a\\b", "", "a//b"]) expect(isSafeRelativePath(p)).toBe(false);
    expect(isSafeRelativePath("tests_hidden/test_a.py")).toBe(true);
    expect(validateBundle({ files: [{ path: "../x", content: "" }] })).toMatch(/unsafe/);
    expect(validateBundle({ files: Array.from({ length: 21 }, (_, i) => ({ path: `t${i}.py`, content: "" })) })).toMatch(/at most/);
    expect(validateBundle({ files: [{ path: "a.py", content: "x".repeat(200_001) }] })).toMatch(/larger/);
  });
});

describe("junit grading", () => {
  const xml = (a: string) => `<?xml version="1.0"?><testsuites><testsuite name="pytest" ${a}></testsuite></testsuites>`;
  it("passes only when tests ran and nothing failed", () => {
    expect(grade(0, false, parseJunit(xml('errors="0" failures="0" skipped="0" tests="9"')))).toMatchObject({ passed: true, testsPassed: 9 });
    expect(grade(1, false, parseJunit(xml('errors="0" failures="2" skipped="0" tests="9"')))).toMatchObject({ passed: false, testsFailed: 2, testsPassed: 7, failureReason: "tests_failed" });
    expect(grade(1, false, parseJunit(xml('errors="1" failures="0" skipped="0" tests="1"')))).toMatchObject({ passed: false, testsErrored: 1 });
    expect(grade(0, false, parseJunit(xml('errors="0" failures="0" skipped="0" tests="0"'))).passed).toBe(false);
    expect(grade(null, true, null)).toMatchObject({ passed: false, failureReason: "timeout" });
  });
});

describe("sandbox command", () => {
  it("docker run is network-less, capped and unprivileged", () => {
    const args = dockerArgs({ image: "img", repoDir: "R", outDir: "O", jobId: "j", testCommand: "pytest -q" }).join(" ");
    for (const flag of ["--network none", "--cap-drop ALL", "no-new-privileges", "--memory 512m", "--pids-limit 256"]) expect(args).toContain(flag);
  });
  it("rejects shell metacharacters in the test command", () => {
    expect(isSafeTestCommand("pytest -q")).toBe(true);
    expect(isSafeTestCommand("pytest; rm -rf /")).toBe(false);
    expect(isSafeTestCommand("pytest $(whoami)")).toBe(false);
  });
});

describe.skipIf(!hasPytest)("verifier HTTP API (local mode, fake chain)", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const token = "t0ken";
  const demo = loadDemo();
  let base = "";
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  const settled: { id: bigint; passed: boolean; resultHash: Hex }[] = [];
  const onChain = new Map<string, OnChainTask>();

  const chain: ChainClient = {
    async getTask(id) {
      return onChain.get(id.toString()) ?? { status: 0, patchHash: "0x00" as Hex, testsHash: "0x00" as Hex, specHash: "0x00" as Hex, resultHash: ("0x" + "0".repeat(64)) as Hex };
    },
    async settle(id, passed, resultHash) {
      settled.push({ id, passed, resultHash });
      const t = onChain.get(id.toString())!;
      onChain.set(id.toString(), { ...t, status: passed ? 4 : 5, resultHash });
      return ("0x" + "ab".repeat(32)) as Hex;
    },
    async validationResponse() { return ("0x" + "cd".repeat(32)) as Hex; },
  };

  beforeAll(async () => {
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "ev-test-")));
    const app = createApp({
      token, validator: account.address, escrow: null,
      pipeline: { store, account, chain, mode: "local", image: "img", timeoutSeconds: 60, publicUrl: "http://v.test", emit: () => undefined, prepareRepo: prepareDemoRepo },
    });
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  const call = (p: string, init?: RequestInit) => fetch(base + p, { ...init, headers: { "content-type": "application/json", "x-verifier-token": token, ...(init?.headers ?? {}) } });

  async function runPatch(chainTaskId: string, patch: string) {
    const up = await (await call("/tests", { method: "POST", body: JSON.stringify(demo.bundle) })).json();
    expect(up.testsHash).toBe(testsHash(demo.bundle));
    onChain.set(chainTaskId, { status: 3, patchHash: keccakUtf8(patch), testsHash: up.testsHash, specHash: keccakUtf8("spec"), resultHash: ("0x" + "0".repeat(64)) as Hex });
    const acc = await call("/verify", {
      method: "POST",
      body: JSON.stringify({ taskId: "t" + chainTaskId, chainTaskId, repoUrl: "https://github.com/x/y", baseCommit: "a".repeat(40), patch, testsId: up.testsId, testsHash: up.testsHash, specialistAgentId: "pixel.eth", erc8004RequestHash: "0x" + "11".repeat(32) }),
    });
    expect(acc.status).toBe(202);
    const { jobId } = await acc.json();
    for (let i = 0; i < 100; i++) {
      const job = await (await call(`/jobs/${jobId}`)).json();
      if (["passed", "failed", "error"].includes(job.status) && (job.settleTxHash || job.error)) return job;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("job did not finish");
  }

  it("requires the token, but health and results are public", async () => {
    expect((await fetch(base + "/jobs/x")).status).toBe(401);
    expect((await fetch(base + "/health")).status).toBe(200);
  });

  it("good patch: PASS, signed by the validator, settled, receipt verifies against the chain", async () => {
    const job = await runPatch("1", demo.good);
    expect(job.status).toBe("passed");
    expect(job.settleTxHash).toBeTruthy();
    expect(job.erc8004TxHash).toBeTruthy();
    const { signature, ...unsigned } = job.result as VerificationResult;
    expect(job.resultHash).toBe(keccakUtf8(canonicalJson(unsigned)));
    expect(await recoverMessageAddress({ message: { raw: job.resultHash }, signature })).toBe(account.address);
    expect(settled.at(-1)).toMatchObject({ passed: true, resultHash: job.resultHash });

    const pub = await (await fetch(`${base}/results/${job.jobId}.json`)).json();
    expect(pub.passed).toBe(true);
    const rec = await (await fetch(`${base}/receipts/${job.jobId}.json`)).json();
    expect(rec.receipt.validation_status).toBe("passed");
    expect(rec.receipt.score).toBe(100);
    expect(hashReceipt(rec.receipt)).toBe(rec.receiptHash);
    const check = await (await fetch(`${base}/receipts/${job.jobId}/verify`)).json();
    expect(check.status).toBe("verified");
  });

  it("weak patch: FAIL, settles as failed (refund path)", async () => {
    const job = await runPatch("2", demo.weak);
    expect(job.status).toBe("failed");
    expect(job.result.failureReason).toBe("tests_failed");
    expect(job.result.testsFailed).toBeGreaterThan(0);
    expect(settled.at(-1)).toMatchObject({ passed: false });
    const rec = await (await fetch(`${base}/receipts/${job.jobId}.json`)).json();
    expect(rec.receipt.score).toBeLessThan(100);
  });

  it("a patch that does not apply fails without running tests", async () => {
    const job = await runPatch("3", "diff --git a/nope.py b/nope.py\n--- a/nope.py\n+++ b/nope.py\n@@ -1 +1 @@\n-x\n+y\n");
    expect(job.status).toBe("failed");
    expect(job.result.failureReason).toBe("patch_did_not_apply");
  });

  it("refuses to grade a patch that differs from the on-chain commitment", async () => {
    const up = await (await call("/tests", { method: "POST", body: JSON.stringify(demo.bundle) })).json();
    onChain.set("4", { status: 3, patchHash: keccakUtf8("something else"), testsHash: up.testsHash, specHash: keccakUtf8("s"), resultHash: ("0x" + "0".repeat(64)) as Hex });
    const { jobId } = await (await call("/verify", { method: "POST", body: JSON.stringify({ taskId: "t4", chainTaskId: "4", repoUrl: "https://github.com/x/y", baseCommit: "a".repeat(40), patch: demo.good, testsId: up.testsId, testsHash: up.testsHash }) })).json();
    let job;
    for (let i = 0; i < 50; i++) { job = await (await call(`/jobs/${jobId}`)).json(); if (job.status === "error") break; await new Promise((r) => setTimeout(r, 100)); }
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/committed on-chain/);
    expect(settled.every((s) => s.id !== 4n)).toBe(true);
  });

  it("a tampered stored receipt is reported invalid", async () => {
    const job = await runPatch("5", demo.good);
    const f = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("ev-test-"));
    let tampered = false;
    for (const d of f) {
      const p = path.join(os.tmpdir(), d, "receipts", `${job.jobId}.json`);
      if (fs.existsSync(p)) {
        const r = JSON.parse(fs.readFileSync(p, "utf8"));
        r.receipt.score = 0;
        fs.writeFileSync(p, JSON.stringify(r));
        tampered = true;
      }
    }
    expect(tampered).toBe(true);
    const check = await (await fetch(`${base}/receipts/${job.jobId}/verify`)).json();
    expect(check.status).toBe("invalid");
  });
});
