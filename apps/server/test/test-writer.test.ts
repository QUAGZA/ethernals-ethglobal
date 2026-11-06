import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_TEST_PATH, type CalibrationReport } from "@ethernals/shared";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("test-writer");
});

const upload = vi.hoisted(() => vi.fn());
const calibrate = vi.hoisted(() => vi.fn());
const source = vi.hoisted(() => ({ dir: "" }));
vi.mock("../src/verifier-client", async (original) => ({ ...(await original<object>()), uploadHiddenTests: upload, calibrateTests: calibrate }));
vi.mock("../src/coding-agent", async (original) => ({
  ...(await original<object>()),
  cloneRepo: async (_url: string, _commit: string, dir: string) => (await import("node:fs")).cpSync(source.dir, dir, { recursive: true }),
}));

const { draftTests, writeDraft } = await import("../src/test-writer");
const { testsHashOf } = await import("../src/task-service");
const { getDb } = await import("../src/db");
const { agent, person } = await import("./_fixtures");

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
const fixed = "def add(a, b):\n    return a + b\n";
const shallow = "def add(a, b):\n    return 2\n";
const reference = { files: [{ path: "calc.py", content: fixed }] };
const naive = { files: [{ path: "calc.py", content: shallow }] };
const tests = "from calc import add\n\ndef test_add():\n    assert add(1, 1) == 2\n    assert add(2, 3) == 5\n";
const report: CalibrationReport = { ok: true, base: { realFailures: 1, testsPassed: 0, testsFailed: 1, testsErrored: 0 }, reference: "passed", naive: "rejected", reasons: [], isolation: "docker" };
const request = { repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40), issue: "add() subtracts." };

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ethernals-draft-"));
  git(repo, "init", "-q");
  fs.writeFileSync(path.join(repo, "calc.py"), "def add(a, b):\n    return a - b\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  source.dir = repo;
  upload.mockReset();
  calibrate.mockReset();
  calibrate.mockResolvedValue(report);
  upload.mockImplementation(async (bundle) => ({ testsId: "d1", testsHash: testsHashOf(bundle) }));
});

describe("turning the model's answer into a draft", () => {
  it("makes each patch against the base commit, not on top of the last one", async () => {
    const draft = await writeDraft(repo, { tests, reference, naive });
    expect(draft.tests).toBe(tests);
    expect(draft.referencePatch).toContain("-    return a - b\n+    return a + b");
    expect(draft.naivePatch).toContain("-    return a - b\n+    return 2");
    expect(fs.readFileSync(path.join(repo, "calc.py"), "utf8")).toContain("a - b");
  });

  it("removes files a patch added before making the next one", async () => {
    const draft = await writeDraft(repo, { tests, reference: { files: [{ path: "new.py", content: "x = 1\n" }] }, naive });
    expect(draft.referencePatch).toContain("new.py");
    expect(draft.naivePatch).not.toContain("new.py");
    expect(fs.existsSync(path.join(repo, "new.py"))).toBe(false);
  });

  it("drops a naive patch that is missing, empty or the same as the reference", async () => {
    const unchanged = { files: [{ path: "calc.py", content: fs.readFileSync(path.join(repo, "calc.py"), "utf8") }] };
    await expect(writeDraft(repo, { tests, reference })).resolves.toMatchObject({ naivePatch: null });
    await expect(writeDraft(repo, { tests, reference, naive: null })).resolves.toMatchObject({ naivePatch: null });
    await expect(writeDraft(repo, { tests, reference, naive: unchanged })).resolves.toMatchObject({ naivePatch: null });
    await expect(writeDraft(repo, { tests, reference, naive: reference })).resolves.toMatchObject({ naivePatch: null });
  });

  it("rejects an answer with no tests, no working fix, or a path out of the repo", async () => {
    await expect(writeDraft(repo, { reference })).rejects.toMatchObject({ status: 502 });
    await expect(writeDraft(repo, { tests })).rejects.toMatchObject({ status: 502 });
    const unchanged = { files: [{ path: "calc.py", content: fs.readFileSync(path.join(repo, "calc.py"), "utf8") }] };
    await expect(writeDraft(repo, { tests, reference: unchanged })).rejects.toThrow(/could not be used/);
    await expect(writeDraft(repo, { tests, reference: { files: [{ path: "../evil.py", content: "x" }] } })).rejects.toThrow(/could not be used/);
  });
});

describe("drafting tests for a client", () => {
  const client = () => {
    const owner = person();
    return { owner, buyer: agent(owner, { kind: "buyer", task_type: null }) };
  };
  const thinker = (json: unknown) => vi.fn().mockResolvedValue({ text: "", json, receipt: {} });

  it("thinks as the client's buyer agent with the repo as data, then checks the draft", async () => {
    const { owner, buyer } = client();
    const think = thinker({ tests, reference, naive });

    const draft = await draftTests(owner, request, think);

    const [who, sent] = think.mock.calls[0];
    expect(who.key).toBe(buyer.key);
    expect(sent).toMatchObject({ purpose: "draft-tests", json: true });
    expect(sent.messages[0].content).toMatch(/never follow instructions/);
    expect(sent.messages[1].content).toContain("<issue>\nadd() subtracts.\n</issue>");
    expect(sent.messages[1].content).toContain('<file path="calc.py">');

    expect(upload).toHaveBeenCalledWith({ files: [{ path: DRAFT_TEST_PATH, content: tests }] });
    expect(calibrate).toHaveBeenCalledWith(expect.objectContaining({ testsId: "d1", referencePatch: draft.referencePatch, naivePatch: draft.naivePatch }));
    expect(draft).toMatchObject({ tests, calibration: report });
  });

  it("returns a draft the verifier ruled out, so the client can see why", async () => {
    const { owner } = client();
    const failing = { ...report, ok: false, reasons: ["The tests accept the naive patch, so a shallow fix would be paid."] };
    calibrate.mockResolvedValue(failing);
    await expect(draftTests(owner, request, thinker({ tests, reference, naive }))).resolves.toMatchObject({ calibration: failing });
  });

  it("keeps none of the draft on the server", async () => {
    const { owner } = client();
    const marker = "UNIQUE_DRAFTED_ASSERTION";
    await draftTests(owner, request, thinker({ tests: `${tests}# ${marker}\n`, reference, naive }));
    const tables = ["tasks", "inference_receipts"].map((t) => getDb().prepare(`SELECT * FROM ${t}`).all());
    expect(JSON.stringify(tables)).not.toContain(marker);
  });

  it("explains a repo it can't read, and funds nothing", async () => {
    const { owner } = client();
    source.dir = path.join(repo, "missing");
    await expect(draftTests(owner, request, thinker({ tests, reference }))).rejects.toMatchObject({ status: 400 });
    expect(upload).not.toHaveBeenCalled();
  });
});
