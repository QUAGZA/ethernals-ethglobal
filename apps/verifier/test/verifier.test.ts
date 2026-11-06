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
import { calibrationIdOf, judge, type Stage } from "../src/calibrate";
import { canaryState, gradeRun, makeCanary } from "../src/canary";
import type { ChainClient, OnChainTask } from "../src/chain";
import { loadDemo, prepareDemoRepo } from "../src/demo";
import { isSafeRelativePath, keccakUtf8, testsHash, validateBundle } from "../src/hashing";
import { grade, parseJunit, realFailures } from "../src/junit";
import { testSetupChange } from "../src/pipeline";
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
  it("does not pass a suite whose tests were all skipped", () => {
    expect(grade(0, false, parseJunit(xml('errors="0" failures="0" skipped="3" tests="3"')))).toMatchObject({ passed: false, testsPassed: 0, failureReason: "no_tests_ran" });
    expect(grade(0, false, parseJunit(xml('errors="0" failures="0" skipped="2" tests="3"'))).passed).toBe(true);
  });
});

describe("realFailures", () => {
  const suite = (cases: string) => `<testsuites><testsuite tests="9">${cases}</testsuite></testsuites>`;
  const testcase = (classname: string, inner = "") => `<testcase classname="${classname}" name="t" time="0.1">${inner}</testcase>`;
  const failed = (message: string) => `<failure message="${message}">trace</failure>`;
  const files = ["tests_hidden/test_x.py", "tests_hidden/helpers.txt"];

  it("counts failed checks in the hidden test files, including classes in them", () => {
    const xml = suite(testcase("tests_hidden.test_x", failed("assert 1 == 2")) + testcase("tests_hidden.test_x.TestThing", failed("AttributeError: no")));
    expect(realFailures(xml, files)).toBe(2);
  });
  it("ignores the repo's own tests, similarly named modules and passing tests", () => {
    const xml = suite(testcase("tests.test_x", failed("assert 0")) + testcase("tests_hidden.test_xy", failed("assert 0")) + testcase("tests_hidden.test_x"));
    expect(realFailures(xml, files)).toBe(0);
  });
  it("does not count code that never ran", () => {
    for (const message of ["ImportError: cannot import", "ModuleNotFoundError: No module named 'x'", "SyntaxError: bad", "NameError: name 'y'"]) {
      expect(realFailures(suite(testcase("tests_hidden.test_x", failed(message))), files)).toBe(0);
    }
  });
});

describe("patches that change how tests run", () => {
  const row = (file: string, added = "1") => `${added}\t0\t${file}\0`;

  it("refuses pytest's own files, at any depth and in any case", () => {
    for (const file of ["conftest.py", "tests/conftest.py", "tests_hidden/conftest.py", "ConfTest.py", "pytest.ini", ".pytest.ini", "pytest.toml", "pyproject.toml", "setup.cfg", "tox.ini"]) {
      expect(testSetupChange(row(file), "")).toBe(`change to ${file}`);
    }
    expect(testSetupChange(row("textkit/a.py") + row("conftest.py"), "")).toMatch(/conftest/);
  });
  it("refuses binary changes, which could carry anything", () => {
    expect(testSetupChange(row("textkit/hook.py", "-"), "")).toMatch(/binary/);
  });
  it("refuses added lines that reach into pytest, but not removed lines or normal test code", () => {
    for (const line of ["import _pytest.reports", "pytest.TestReport.from_item_and_call = x", "@pytest.hookimpl(hookwrapper=True)", "def pytest_runtest_makereport(item, call):", 'pytest_plugins = ["x"]']) {
      expect(testSetupChange(row("textkit/a.py"), `+${line}`)).toMatch(/reaches into pytest/);
    }
    expect(testSetupChange(row("textkit/a.py"), "-import _pytest\n import _pytest\n+++ b/pytest_helpers.py\n--- a/_pytest.py\n+x = 1")).toBeNull();
    expect(testSetupChange(row("tests/test_a.py"), "+import pytest\n+@pytest.mark.parametrize('a', [1])\n+@pytest.fixture")).toBeNull();
  });
  it("allows normal files, including ones with similar names", () => {
    expect(testSetupChange(row("textkit/slugify.py") + row("my_conftest.py") + row("docs/setup.md"), "+x = 1")).toBeNull();
  });
});

describe("the canary", () => {
  const bundle = { files: [{ path: "tests_hidden/test_x.py", content: "" }] };
  const canary = makeCanary(bundle);
  const report = (tests: number, failures: number, errors: number, cases: string, skipped = 0) =>
    `<testsuites><testsuite errors="${errors}" failures="${failures}" skipped="${skipped}" tests="${tests}">${cases}</testsuite></testsuites>`;
  const testcase = (inner = "") => `<testcase classname="${canary.classname}" name="${canary.name}" time="0">${inner}</testcase>`;
  const failed = testcase('<failure message="assert 1 == 2">trace</failure>');
  const real = (inner = "") => `<testcase classname="tests_hidden.test_x" name="test_real" time="0">${inner}</testcase>`;
  const run = (exitCode: number, junitXml: string | null, timedOut = false) => ({ exitCode, timedOut, junitXml });

  it("is new every run, sits beside the hidden tests and is a test that must fail", () => {
    const other = makeCanary(bundle);
    expect(other.path).not.toBe(canary.path);
    expect(other.name).not.toBe(canary.name);
    expect(canary.path).toMatch(/^tests_hidden\/test_[0-9a-f]+\.py$/);
    const [, left, right] = /assert (\d+) == (\d+)/.exec(canary.content)!;
    expect(left).not.toBe(right);
    expect(makeCanary({ files: [{ path: "tests/deep/test_a.py", content: "" }] }).path).toMatch(/^tests\/deep\//);
    expect(makeCanary({ files: [{ path: "helpers.txt", content: "" }] }).path).toMatch(/^tests_hidden\//);
  });

  it("leaves a clean pass looking exactly like a run without it", () => {
    const { grade: result, canary: state } = gradeRun(run(1, report(10, 1, 0, failed + real())), canary);
    expect(state).toBe("failed");
    expect(result).toEqual({ passed: true, testsPassed: 9, testsFailed: 0, testsErrored: 0, failureReason: null });
  });
  it("keeps a real failure a failure, without counting the canary", () => {
    expect(gradeRun(run(1, report(10, 3, 0, failed + real())), canary).grade).toMatchObject({ passed: false, testsPassed: 7, testsFailed: 2, failureReason: "tests_failed" });
  });
  it("does not turn a suite of skips into a pass", () => {
    expect(gradeRun(run(1, report(4, 1, 0, failed, 3)), canary).grade).toMatchObject({ passed: false, failureReason: "no_tests_ran" });
  });
  it("treats a canary reported as passed or skipped as tampering, whatever else the run says", () => {
    for (const cases of [testcase(), testcase('<skipped message="x"/>')]) {
      expect(gradeRun(run(0, report(10, 0, 0, cases + real())), canary).grade).toEqual({ passed: false, testsPassed: 0, testsFailed: 0, testsErrored: 0, failureReason: "results_tampered" });
    }
  });
  it("treats a canary removed from a clean run as tampering", () => {
    expect(gradeRun(run(0, report(9, 0, 0, real())), canary)).toMatchObject({ canary: "missing", grade: { failureReason: "results_tampered" } });
  });
  it("does not call an honest crash tampering, when pytest stopped before the canary ran", () => {
    expect(gradeRun(run(2, report(1, 0, 1, real('<error message="collection failure">x</error>'))), canary)).toMatchObject({ canary: "missing", grade: { passed: false, failureReason: "tests_failed" } });
    expect(gradeRun(run(1, null, true), canary).grade.failureReason).toBe("timeout");
    expect(gradeRun(run(1, null), canary).grade.passed).toBe(false);
  });
  it("matches only its own test", () => {
    expect(canaryState(report(1, 1, 0, real('<failure message="x">y</failure>')), canary)).toBe("missing");
  });
});

describe("calibration rules", () => {
  const passed = grade(0, false, { tests: 3, failures: 0, errors: 0, skipped: 0 });
  const failing = grade(1, false, { tests: 3, failures: 2, errors: 0, skipped: 0 });
  const redBase: Stage = { applied: true, grade: failing, realFailures: 2 };
  const green: Stage = { applied: true, grade: passed, realFailures: 0 };
  const notApplied: Stage = { applied: false, grade: grade(null, false, null), realFailures: 0 };

  it("accepts tests that fail on the base, pass the reference and reject the naive patch", () => {
    expect(judge(redBase, green, redBase, "docker")).toMatchObject({ ok: true, reference: "passed", naive: "rejected", reasons: [], base: { realFailures: 2 } });
  });
  it("needs no patches: without them only the base check applies", () => {
    expect(judge(redBase, null, null, "none")).toMatchObject({ ok: true, reference: "not_provided", naive: "not_provided" });
  });
  it("rules out tests that already pass on the unfixed code", () => {
    const report = judge(green, null, null, "none");
    expect(report.ok).toBe(false);
    expect(report.reasons[0]).toMatch(/already pass/);
  });
  it("rules out a suite that never ran", () => {
    const skipped: Stage = { applied: true, grade: grade(0, false, { tests: 3, failures: 0, errors: 0, skipped: 3 }), realFailures: 0 };
    expect(judge(skipped, null, null, "none").reasons[0]).toMatch(/skipped/);
  });
  it("rules out tests that only hit import errors or the repo's own failures", () => {
    expect(judge({ applied: true, grade: failing, realFailures: 0 }, null, null, "none").reasons[0]).toMatch(/never failed a real check/);
  });
  it("rules out a timeout on the unfixed code", () => {
    expect(judge({ applied: true, grade: grade(null, true, null), realFailures: 0 }, null, null, "none").reasons[0]).toMatch(/timed out/);
  });
  it("rules out tests the reference fix cannot pass, or a fix that does not apply", () => {
    expect(judge(redBase, redBase, null, "none")).toMatchObject({ ok: false, reference: "failed" });
    expect(judge(redBase, notApplied, null, "none").reasons[0]).toMatch(/does not apply/);
  });
  it("rules out tests that accept the naive patch", () => {
    expect(judge(redBase, green, green, "none")).toMatchObject({ ok: false, naive: "accepted" });
  });
  const tampered: Stage = { applied: true, grade: { passed: false, testsPassed: 0, testsFailed: 0, testsErrored: 0, failureReason: "results_tampered" }, canary: "passed", realFailures: 0 };
  it("rules out tests that stop the control test failing on the unfixed code", () => {
    expect(judge(tampered, null, null, "none").reasons[0]).toMatch(/control test/);
  });
  it("rules out tests whose control test never ran, since every later pass would then count as tampering", () => {
    expect(judge({ ...redBase, canary: "missing" }, green, null, "none")).toMatchObject({ ok: false, reasons: [expect.stringMatching(/control test/)] });
  });
  it("rules out a reference fix that stops the control test failing", () => {
    expect(judge(redBase, tampered, null, "none")).toMatchObject({ ok: false, reference: "failed", reasons: [expect.stringMatching(/control test/)] });
  });
  it("rules out a reference fix that changes test setup", () => {
    expect(judge(redBase, { ...notApplied, refused: true }, null, "none").reasons[0]).toMatch(/changes test setup/);
  });
  it("does not count a naive patch that crashed or did not apply as rejected, and does not block on it", () => {
    const crashed: Stage = { applied: true, grade: grade(1, false, { tests: 1, failures: 0, errors: 1, skipped: 0 }), realFailures: 0 };
    expect(judge(redBase, green, crashed, "none")).toMatchObject({ ok: true, naive: "inconclusive" });
    expect(judge(redBase, green, notApplied, "none")).toMatchObject({ ok: true, naive: "inconclusive" });
  });
  it("gives the same inputs the same id, and different patches a different one", () => {
    const request = { repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40), testsId: "x", testsHash: "0x00" as Hex, referencePatch: "one" };
    expect(calibrationIdOf(request)).toBe(calibrationIdOf({ ...request, testCommand: "pytest -q" }));
    expect(calibrationIdOf(request)).not.toBe(calibrationIdOf({ ...request, referencePatch: "two" }));
  });
});

describe("sandbox command", () => {
  it("docker run is network-less, capped and unprivileged", () => {
    const args = dockerArgs({ image: "img", repoDir: "R", outDir: "O", jobId: "j", testCommand: "pytest -q" }).join(" ");
    for (const flag of ["--network none", "--cap-drop ALL", "no-new-privileges", "--memory 512m", "--pids-limit 256"]) expect(args).toContain(flag);
  });
  it("always runs every test, even if the command says -x", () => {
    expect(dockerArgs({ image: "img", repoDir: "R", outDir: "O", jobId: "j", testCommand: "pytest -x" }).join(" ")).toContain("pytest -x --maxfail=0");
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
  let settleFails = false;
  const onChain = new Map<string, OnChainTask>();

  const chain: ChainClient = {
    async getTask(id) {
      return onChain.get(id.toString()) ?? { status: 0, patchHash: "0x00" as Hex, testsHash: "0x00" as Hex, specHash: "0x00" as Hex, resultHash: ("0x" + "0".repeat(64)) as Hex };
    },
    async settle(id, passed, resultHash) {
      if (settleFails) throw new Error("rpc down");
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

  async function calibrate(body: Record<string, unknown>) {
    const { calibrationId } = await (await call("/calibrations", { method: "POST", body: JSON.stringify({ repoUrl: "https://github.com/x/y", baseCommit: "a".repeat(40), ...body }) })).json();
    for (let i = 0; i < 150; i++) {
      const job = await (await call(`/calibrations/${calibrationId}`)).json();
      if (job.status === "done" || job.status === "error") return job;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("calibration did not finish");
  }
  const upload = async (files: { path: string; content: string }[]) => (await call("/tests", { method: "POST", body: JSON.stringify({ files }) })).json();

  it("calibration: the demo tests fail on the base, pass the good patch and reject the weak one", async () => {
    const up = await upload(demo.bundle.files);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, referencePatch: demo.good, naivePatch: demo.weak });
    expect(job).toMatchObject({ status: "done", report: { ok: true, reference: "passed", naive: "rejected", isolation: "none" } });
    expect(job.report.base.realFailures).toBeGreaterThan(0);
  });

  it("calibration: rules out tests that always pass or are all skipped, even with a real fix supplied", async () => {
    for (const content of ["def test_nothing():\n    assert True\n", "import pytest\n\n@pytest.mark.skip\ndef test_nothing():\n    assert False\n"]) {
      const up = await upload([{ path: "tests_hidden/test_x.py", content }]);
      const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, referencePatch: demo.good });
      expect(job.report.ok).toBe(false);
    }
  });

  it("calibration: rules out tests that only fail on a bad import", async () => {
    const up = await upload([{ path: "tests_hidden/test_x.py", content: "def test_it():\n    from textkit.nope import x\n" }]);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash });
    expect(job.report).toMatchObject({ ok: false, base: { realFailures: 0 } });
  });

  it("calibration: rules out tests no correct fix can pass", async () => {
    const up = await upload([{ path: "tests_hidden/test_x.py", content: "from textkit.slugify import slugify\n\ndef test_it():\n    assert slugify('a b') == 'wrong'\n" }]);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, referencePatch: demo.good });
    expect(job.report).toMatchObject({ ok: false, reference: "failed" });
  });

  const forcePass = ["import pytest", "", "@pytest.hookimpl(hookwrapper=True)", "def pytest_runtest_makereport(item, call):", "    outcome = yield", '    outcome.get_result().outcome = "passed"', ""].map((l) => `+${l}`).join("\n");
  const newFile = (header: string, body: string, lines: number) => `${header}\nnew file mode 100644\n--- /dev/null\n+++ ${header.split(" ").at(-1)}\n@@ -0,0 +1,${lines} @@\n${body}\n`;

  it.each([
    ["a new conftest.py", newFile("diff --git a/conftest.py b/conftest.py", forcePass, 7)],
    ["a conftest.py with a quoted path", newFile('diff --git "a/conf\\164est.py" "b/conf\\164est.py"', forcePass, 7)],
    ["pytest config", newFile("diff --git a/.pytest.ini b/.pytest.ini", "+[pytest]\n+addopts = -p no:terminal", 2)],
    ["a hook in a source file", 'diff --git a/textkit/slugify.py b/textkit/slugify.py\n--- a/textkit/slugify.py\n+++ b/textkit/slugify.py\n@@ -1,2 +1,3 @@\n+import _pytest.reports\n def slugify(text: str) -> str:\n     """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""\n'],
  ])("refuses a patch that tries to force a pass with %s, and settles it as failed", async (name, patch) => {
    const job = await runPatch(`4${name.length}`, patch);
    expect(job.status).toBe("failed");
    expect(job.result).toMatchObject({ passed: false, testsPassed: 0, failureReason: "patch_changes_test_setup" });
    expect(settled.at(-1)).toMatchObject({ passed: false });
  });

  const disguisedHook = [
    "",
    '_m = __import__("importlib").import_module("_py" + "test.reports")',
    '_c = getattr(_m, "Test" + "Report")',
    "_f = _c.from_item_and_call",
    "def _forced(item, call):",
    "    r = _f(item, call)",
    '    r.outcome = "passed"',
    "    r.longrepr = None",
    "    return r",
    "_c.from_item_and_call = staticmethod(_forced)",
  ].map((l) => `+${l}`).join("\n");
  const disguised = `diff --git a/textkit/slugify.py b/textkit/slugify.py\n--- a/textkit/slugify.py\n+++ b/textkit/slugify.py\n@@ -1,3 +1,13 @@\n def slugify(text: str) -> str:\n     """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""\n     return text.strip().lower().replace(" ", "-")\n${disguisedHook}\n`;

  it("catches disguised code that gets past the patch check and forces every test to pass", async () => {
    const job = await runPatch("51", disguised);
    expect(job.status).toBe("failed");
    expect(job.result).toMatchObject({ passed: false, failureReason: "results_tampered" });
    expect(settled.at(-1)).toMatchObject({ passed: false });
  });

  it("keeps an honest pass and count, and shows the expected control failure in the log", async () => {
    const job = await runPatch("52", demo.good);
    expect(job.result).toMatchObject({ passed: true, testsPassed: expect.any(Number), testsFailed: 0, failureReason: null });
    expect(job.logTail.join("\n")).toContain("the control test failed as expected");
  });

  it("runs every test under pytest -x, so the canary can't end the run early", async () => {
    const up = await upload(demo.bundle.files);
    const onChainPatch = { status: 3, patchHash: keccakUtf8(demo.good), testsHash: up.testsHash, specHash: keccakUtf8("spec"), resultHash: ("0x" + "0".repeat(64)) as Hex };
    const counts: number[] = [];
    for (const [chainTaskId, testCommand] of [["53", "pytest -q"], ["54", "pytest -q -x"]]) {
      onChain.set(chainTaskId, onChainPatch);
      const { jobId } = await (await call("/verify", { method: "POST", body: JSON.stringify({ taskId: `t${chainTaskId}`, chainTaskId, repoUrl: "https://github.com/x/y", baseCommit: "a".repeat(40), patch: demo.good, testsId: up.testsId, testsHash: up.testsHash, testCommand }) })).json();
      let job = await (await call(`/jobs/${jobId}`)).json();
      for (let i = 0; i < 100 && !job.settleTxHash; i++) { await new Promise((r) => setTimeout(r, 100)); job = await (await call(`/jobs/${jobId}`)).json(); }
      expect(job.result.passed).toBe(true);
      counts.push(job.result.testsPassed);
    }
    expect(counts[1]).toBe(counts[0]);
  });

  it("fails a syntax error normally, not as tampering", async () => {
    const broken = 'diff --git a/textkit/slugify.py b/textkit/slugify.py\n--- a/textkit/slugify.py\n+++ b/textkit/slugify.py\n@@ -1,2 +1,3 @@\n+def broken(:\n def slugify(text: str) -> str:\n     """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""\n';
    const job = await runPatch("55", broken);
    expect(job.result).toMatchObject({ passed: false, failureReason: "tests_failed" });
  });

  it("calibration: catches the same disguised hook in a reference fix", async () => {
    const up = await upload(demo.bundle.files);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, referencePatch: disguised });
    expect(job.report).toMatchObject({ ok: false, reference: "failed" });
    expect(job.report.reasons[0]).toMatch(/control test/);
  });

  it("calibration: catches hidden tests that rewrite results themselves", async () => {
    const hook = disguisedHook.replaceAll(/^\+/gm, "");
    const up = await upload([{ path: "tests_hidden/test_x.py", content: `${hook}\n\ndef test_ok():\n    assert False\n` }]);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash });
    expect(job.report.ok).toBe(false);
    expect(job.report.reasons[0]).toMatch(/control test/);
  });

  it("calibration: refuses a test command that leaves the hidden tests and canary out", async () => {
    const up = await upload(demo.bundle.files);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, testCommand: "pytest -q tests" });
    expect(job.report.ok).toBe(false);
  });

  it("calibration: rules out a reference fix that forces a pass", async () => {
    const up = await upload(demo.bundle.files);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, referencePatch: newFile("diff --git a/conftest.py b/conftest.py", forcePass, 7) });
    expect(job.report).toMatchObject({ ok: false, reference: "failed" });
    expect(job.report.reasons[0]).toMatch(/changes test setup/);
  });

  it("does not store the patches it checked", async () => {
    const up = await upload(demo.bundle.files);
    const job = await calibrate({ testsId: up.testsId, testsHash: up.testsHash, referencePatch: demo.good });
    expect(JSON.stringify(job)).not.toContain("textkit");
  });

  it("reveals the tests only after settlement", async () => {
    const needsToken = await fetch(`${base}/jobs/nope/tests`);
    expect(needsToken.status).toBe(401);
    expect((await call("/jobs/nope/tests")).status).toBe(404);

    const job = await runPatch("31", demo.good);
    const revealed = await (await call(`/jobs/${job.jobId}/tests`)).json();
    expect(revealed.testsHash).toBe(testsHash(demo.bundle));
    expect(testsHash({ files: revealed.files })).toBe(revealed.testsHash);

    settleFails = true;
    const unsettled = await runPatch("32", demo.good).catch(() => null);
    settleFails = false;
    expect(unsettled?.settleTxHash).toBeNull();
    expect((await call(`/jobs/${unsettled!.jobId}/tests`)).status).toBe(409);
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
