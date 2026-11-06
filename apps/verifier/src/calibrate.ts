/**
 * Checks tests before any money depends on them, because a pass pays the bounty and writes a 5-star rating.
 * It rules out tests that cannot tell a fix from no fix, or that a correct fix cannot pass. It cannot prove tests are good.
 * Test output stays in here: the report holds counts only, since the tests are still hidden when it is shown.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson, type CalibrationJob, type CalibrationReport, type CalibrationRequest, type HiddenTestsBundle } from "@ethernals/shared";
import { addCanary, gradeRun, makeCanary, type CanaryState } from "./canary";
import { keccakUtf8 } from "./hashing";
import { grade, realFailures, type Grade } from "./junit";
import { addTests, applyPatch, cloneRepo, type PipelineDeps } from "./pipeline";
import { runTests } from "./runner";

export interface Stage {
  applied: boolean;
  /** The patch was refused for changing how pytest runs. */
  refused?: boolean;
  grade: Grade;
  /** The verifier's control test, when the tests ran. */
  canary?: CanaryState;
  /** Hidden tests that failed a real check in this run. */
  realFailures: number;
}

/** The same inputs share an id, so checking a draft and then funding it runs the tests once. Patches count by hash. */
export function calibrationIdOf(req: CalibrationRequest): string {
  const hashOf = (patch?: string) => (patch ? keccakUtf8(patch) : null);
  return keccakUtf8(
    canonicalJson({
      repoUrl: req.repoUrl,
      baseCommit: req.baseCommit,
      testsHash: req.testsHash,
      testCommand: req.testCommand ?? "pytest -q",
      reference: hashOf(req.referencePatch),
      naive: hashOf(req.naivePatch),
    }),
  ).slice(2, 26);
}

/** Reads the three runs. Pure, so each rule has a test. A null stage means that patch was not supplied. */
export function judge(base: Stage, reference: Stage | null, naive: Stage | null, isolation: CalibrationReport["isolation"]): CalibrationReport {
  const reasons: string[] = [];

  const controlBroke = base.grade.failureReason === "results_tampered" || (base.canary === "missing" && base.realFailures > 0);
  if (base.grade.failureReason === "timeout") reasons.push("The tests timed out on the unfixed code.");
  else if (controlBroke) reasons.push("The verifier's control test did not fail on the unfixed code, so results could not be trusted. Check the test command, the test file names and anything in the tests that changes how pytest runs.");
  else if (base.realFailures === 0) {
    if (base.grade.failureReason === "no_tests_ran") reasons.push("No tests ran on the unfixed code: every test was skipped or none were found.");
    else if (base.grade.passed) reasons.push("The tests already pass on the unfixed code, so passing them proves nothing about a fix.");
    else reasons.push("The hidden tests never failed a real check on the unfixed code: they hit import or setup errors, or only the repo's own tests failed.");
  }

  const referenceVerdict: CalibrationReport["reference"] = !reference ? "not_provided" : reference.applied && reference.grade.passed ? "passed" : "failed";
  if (reference?.refused) reasons.push("The reference fix changes test setup, such as conftest.py or pytest config, so no specialist could match it.");
  else if (reference && !reference.applied) reasons.push("The reference fix does not apply to this commit.");
  else if (reference?.grade.failureReason === "results_tampered") reasons.push("The verifier's control test did not fail with the reference fix, so that result could not be trusted.");
  else if (referenceVerdict === "failed") reasons.push("The tests fail with the reference fix, so a correct fix might never earn the bounty.");

  // A naive patch that crashes proves nothing either way, so only a clean failed check counts as rejected.
  let naiveVerdict: CalibrationReport["naive"] = "not_provided";
  if (naive) {
    if (naive.applied && naive.grade.passed) naiveVerdict = "accepted";
    else if (naive.applied && naive.realFailures > 0) naiveVerdict = "rejected";
    else naiveVerdict = "inconclusive";
  }
  if (naiveVerdict === "accepted") reasons.push("The tests accept the naive patch, so a shallow fix would be paid.");

  return {
    ok: reasons.length === 0,
    base: {
      realFailures: base.realFailures,
      testsPassed: base.grade.testsPassed,
      testsFailed: base.grade.testsFailed,
      testsErrored: base.grade.testsErrored,
    },
    reference: referenceVerdict,
    naive: naiveVerdict,
    reasons,
    isolation,
  };
}

export async function runCalibration(deps: PipelineDeps, calibrationId: string, req: CalibrationRequest): Promise<CalibrationJob> {
  const { store } = deps;
  const save = (patch: Partial<CalibrationJob>) => {
    const job: CalibrationJob = { calibrationId, status: "running", report: null, error: null, ...patch };
    store.putCalibration(job);
    return job;
  };
  const work = path.join(os.tmpdir(), "ethernals-calibrate", calibrationId);
  try {
    save({ status: "running" });
    const bundle = store.getTests(req.testsId);
    if (!bundle) return save({ status: "error", error: "unknown testsId" });
    const silent = () => undefined;

    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const prepared = path.join(work, "prepared");
    await (deps.prepareRepo ?? cloneRepo)(prepared, req, silent);

    const stage = (name: string, patch: string | null) => runStage(deps, { work, prepared, bundle, calibrationId, name, patch, testCommand: req.testCommand ?? "pytest -q" });
    const base = await stage("base", null);
    const reference = req.referencePatch ? await stage("reference", req.referencePatch) : null;
    const naive = req.naivePatch ? await stage("naive", req.naivePatch) : null;
    return save({ status: "done", report: judge(base, reference, naive, deps.mode === "docker" ? "docker" : "none") });
  } catch (e) {
    return save({ status: "error", error: (e as Error).message });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function runStage(
  deps: PipelineDeps,
  o: { work: string; prepared: string; bundle: HiddenTestsBundle; calibrationId: string; name: string; patch: string | null; testCommand: string },
): Promise<Stage> {
  const root = path.join(o.work, o.name);
  const repoDir = path.join(root, "repo");
  fs.cpSync(o.prepared, repoDir, { recursive: true, verbatimSymlinks: true });

  const patched = o.patch === null ? "applied" : await applyPatch(repoDir, o.patch, () => undefined);
  if (patched !== "applied") {
    return { applied: false, refused: patched === "changes_test_setup", grade: grade(null, false, null), realFailures: 0 };
  }
  if (!addTests(repoDir, o.bundle)) throw new Error("unsafe path in hidden tests");
  const canary = makeCanary(o.bundle);
  addCanary(repoDir, canary);

  const outcome = await (deps.run ?? runTests)({
    mode: deps.mode,
    image: deps.image,
    repoDir,
    outDir: path.join(root, "out"),
    jobId: `${o.calibrationId}-${o.name}`,
    testCommand: o.testCommand,
    timeoutSeconds: deps.timeoutSeconds,
    onLine: () => undefined,
  });
  const graded = gradeRun(outcome, canary);
  return {
    applied: true,
    ...graded,
    realFailures: outcome.junitXml ? realFailures(outcome.junitXml, o.bundle.files.map((f) => f.path)) : 0,
  };
}
