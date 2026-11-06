/**
 * A control test: added to every run with a random name, and it must fail. Patched code runs inside pytest, so it can
 * rewrite results however well it is disguised. If this test does not report a failure, the results can't be trusted.
 * It catches a patch that forces every test to pass. A patch that first works out which test is the canary could dodge it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HiddenTestsBundle } from "@ethernals/shared";
import { grade, parseJunit, testcases, type Grade } from "./junit";
import type { RunOutcome } from "./runner";

export interface Canary {
  path: string;
  classname: string;
  name: string;
  content: string;
}

/** "passed" means anything but a failure: passed, skipped or xfailed. */
export type CanaryState = "failed" | "passed" | "missing";

/** Goes beside the hidden tests, so a run that collects them collects it too. */
export function makeCanary(bundle: HiddenTestsBundle): Canary {
  const hidden = bundle.files.find((f) => /(^|\/)test_[^/]*\.py$/.test(f.path));
  const dir = hidden ? path.posix.dirname(hidden.path) : "tests_hidden";
  const name = `test_${crypto.randomBytes(6).toString("hex")}`;
  const file = path.posix.join(dir, `test_${crypto.randomBytes(6).toString("hex")}.py`);
  const left = crypto.randomInt(1000, 9999);
  return {
    path: file,
    classname: file.slice(0, -3).replaceAll("/", "."),
    name,
    content: `def ${name}():\n    assert ${left} == ${left + crypto.randomInt(1, 100)}\n`,
  };
}

/** Written after the patch is applied, so a patch can't name it in advance. */
export function addCanary(repoDir: string, canary: Canary): void {
  const dest = path.join(repoDir, ...canary.path.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, canary.content);
}

export function canaryState(xml: string, canary: Canary): CanaryState {
  const found = testcases(xml).find((t) => t.classname === canary.classname && t.name === canary.name);
  if (!found) return "missing";
  return /<failure\b/.test(found.body) ? "failed" : "passed";
}

/** Grades a run as if the canary had never been there, so counts and signed results cover only the real tests. */
export function gradeRun(outcome: RunOutcome, canary: Canary): { grade: Grade; canary: CanaryState } {
  const xml = outcome.junitXml;
  if (outcome.timedOut || !xml) return { grade: grade(outcome.exitCode, outcome.timedOut, xml ? parseJunit(xml) : null), canary: "missing" };

  const summary = parseJunit(xml);
  const state = canaryState(xml, canary);
  if (state === "failed") {
    const rest = { ...summary, tests: summary.tests - 1, failures: summary.failures - 1 };
    const onlyTheCanaryFailed = outcome.exitCode === 1 && rest.failures + rest.errors === 0;
    return { grade: grade(onlyTheCanaryFailed ? 0 : outcome.exitCode, false, rest), canary: state };
  }
  // A crash can stop pytest before the canary runs. That is a normal failure, and it pays nothing anyway.
  if (state === "missing" && summary.failures + summary.errors > 0) return { grade: grade(outcome.exitCode, false, summary), canary: state };
  return { grade: { passed: false, testsPassed: 0, testsFailed: 0, testsErrored: 0, failureReason: "results_tampered" }, canary: state };
}
