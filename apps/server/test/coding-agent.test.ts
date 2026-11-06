import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskSpec } from "@ethernals/shared";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("coding");
});

const { collectFiles, runCodingAgent, safeRepoPath, writeAnswer } = await import("../src/coding-agent");
const { agent, person } = await import("./_fixtures");

const spec: TaskSpec = { version: 1, kind: "code-fix", language: "python", title: "Fix", repoUrl: "https://github.com/a/b", baseCommit: "a".repeat(40), issue: "add() subtracts." };
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t.t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ethernals-repo-"));
  git(repo, "init", "-q");
  fs.writeFileSync(path.join(repo, "calc.py"), "def add(a, b):\n    return a - b\n");
  fs.mkdirSync(path.join(repo, "tests"));
  fs.writeFileSync(path.join(repo, "tests/test_calc.py"), "from calc import add\n\ndef test_add():\n    assert add(1, 1) == 2\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
});

const answer = (files: unknown, explanation = "Fixed add.") => vi.fn().mockResolvedValue({ text: "", json: { files, explanation }, receipt: {} });

describe("the coding agent", () => {
  it("turns the model's files into a git diff", async () => {
    const thinker = answer([{ path: "calc.py", content: "def add(a, b):\n    return a + b\n" }]);
    const result = await runCodingAgent({ seller: agent(person()), taskId: "t", spec, template: null, dir: repo, thinker });

    expect(result.explanation).toBe("Fixed add.");
    expect(result.patch).toContain("-    return a - b");
    expect(result.patch).toContain("+    return a + b");
    const request = thinker.mock.calls[0][1];
    expect(request).toMatchObject({ purpose: "code-fix", taskId: "t", json: true });
    expect(request.messages[1].content).toContain("add() subtracts.");
    expect(request.messages[1].content).toContain("tests/test_calc.py");
    expect(request.messages[0].content).toMatch(/data/);
  });

  it("includes new files in the diff", async () => {
    const thinker = answer([{ path: "pkg/new.py", content: "x = 1\n" }]);
    const { patch } = await runCodingAgent({ seller: agent(person()), taskId: "t", spec, template: null, dir: repo, thinker });
    expect(patch).toContain("pkg/new.py");
  });

  it("treats an empty diff as an error", async () => {
    const same = fs.readFileSync(path.join(repo, "calc.py"), "utf8");
    await expect(runCodingAgent({ seller: agent(person()), taskId: "t", spec, template: null, dir: repo, thinker: answer([{ path: "calc.py", content: same }]) })).rejects.toThrow(/changed nothing/);
  });

  it("uses a minimal prompt for a weak agent without a template", async () => {
    const thinker = answer([{ path: "calc.py", content: "pass\n" }]);
    await runCodingAgent({ seller: agent(person(), { strategy: "weak" }), taskId: "t", spec, template: null, dir: repo, thinker });
    expect(thinker.mock.calls[0][1].messages[0].content).toMatch(/smallest possible/);
  });

  it("gives a weak agent the template's weak patch, and it still thinks once", async () => {
    const templates = fs.mkdtempSync(path.join(os.tmpdir(), "ethernals-templates-"));
    fs.mkdirSync(path.join(templates, "slugify"));
    fs.writeFileSync(path.join(templates, "slugify/weak.patch"), "WEAK PATCH");
    const thinker = vi.fn().mockResolvedValue({ text: "A small change.", json: undefined, receipt: {} });
    const result = await runCodingAgent({ seller: agent(person(), { strategy: "weak" }), taskId: "t", spec, template: "slugify", dir: repo, thinker, templatesDir: templates });
    expect(result).toEqual({ patch: "WEAK PATCH", explanation: "A small change." });
    expect(thinker).toHaveBeenCalledTimes(1);
  });
});

describe("what the agent may read and write", () => {
  it("rejects paths outside the repo", () => {
    for (const bad of ["../evil.py", "/etc/passwd", "a/../../evil.py", ".git/hooks/pre-commit", "a/.git/config"]) {
      expect(() => safeRepoPath(repo, bad)).toThrow(/unsafe path/);
    }
    expect(safeRepoPath(repo, "src/a.py")).toBe(path.join(repo, "src/a.py"));
  });

  it("writes nothing when one path is unsafe at the start", async () => {
    await expect(writeAnswer(repo, { files: [{ path: "../evil.py", content: "x" }] })).rejects.toThrow(/unsafe path/);
    expect(fs.existsSync(path.join(repo, "..", "evil.py"))).toBe(false);
  });

  it("rejects malformed answers", async () => {
    await expect(writeAnswer(repo, { files: [] })).rejects.toThrow(/no files/);
    await expect(writeAnswer(repo, { files: [{ path: 1, content: "x" }] })).rejects.toThrow(/malformed/);
  });

  it("collects text files and skips .git, binaries and large files", async () => {
    fs.writeFileSync(path.join(repo, "blob.bin"), Buffer.from([1, 0, 2]));
    fs.writeFileSync(path.join(repo, "large.py"), "x".repeat(21 * 1024));
    const paths = (await collectFiles(repo)).map((f) => f.path);
    expect(paths).toEqual(["calc.py", "tests/test_calc.py"]);
  });

  it("caps the file count at 20", async () => {
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(repo, `f${i}.py`), "x");
    expect((await collectFiles(repo)).length).toBe(20);
  });
});
