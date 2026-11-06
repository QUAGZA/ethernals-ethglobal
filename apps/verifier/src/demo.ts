import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./config";
import type { HiddenTestsBundle, VerifyRequest } from "@ethernals/shared";

export const DEMO_DIR = path.join(ROOT_DIR, "demo", "tasks", "slugify");

/** Reads the demo task: the hidden-tests bundle and the two reference patches. */
export function loadDemo() {
  const hiddenDir = path.join(DEMO_DIR, "hidden_tests");
  const files: HiddenTestsBundle["files"] = [];
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (!name.endsWith(".pyc")) {
        files.push({ path: path.relative(hiddenDir, full).split(path.sep).join("/"), content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(hiddenDir);
  return {
    bundle: { files } satisfies HiddenTestsBundle,
    good: fs.readFileSync(path.join(DEMO_DIR, "good.patch"), "utf8"),
    weak: fs.readFileSync(path.join(DEMO_DIR, "weak.patch"), "utf8"),
  };
}

/** Test/selftest stand-in for cloneRepo: builds a local git repo from demo/tasks/slugify/repo (no network, no GitHub push). */
export async function prepareDemoRepo(repoDir: string, _req: unknown, log: (l: string) => void = () => undefined) {
  fs.cpSync(path.join(DEMO_DIR, "repo"), repoDir, { recursive: true });
  const run = (args: string[]) => spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: repoDir, encoding: "utf8" });
  run(["init", "-q"]);
  run(["add", "-A"]);
  run(["-c", "user.email=v@e.v", "-c", "user.name=verifier", "commit", "-qm", "base"]);
  log("prepared local demo repo");
}
