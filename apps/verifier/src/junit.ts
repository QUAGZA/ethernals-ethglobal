export interface JunitSummary {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
}

/** Sums the attributes of every <testsuite ...> element (pytest writes one, possibly wrapped in <testsuites>). */
export function parseJunit(xml: string): JunitSummary {
  const out: JunitSummary = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const re = /<testsuite\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attr = (name: string) => {
      const a = new RegExp(`\\b${name}="(\\d+)"`).exec(m![1]);
      return a ? Number(a[1]) : 0;
    };
    out.tests += attr("tests");
    out.failures += attr("failures");
    out.errors += attr("errors");
    out.skipped += attr("skipped");
  }
  return out;
}

export interface Grade {
  passed: boolean;
  testsPassed: number;
  testsFailed: number;
  testsErrored: number;
  failureReason: "tests_failed" | "no_tests_ran" | "timeout" | "patch_did_not_apply" | "patch_changes_test_setup" | "results_tampered" | null;
}

/** passed = exit code 0, no failures or errors, and at least one test actually ran. */
export function grade(exitCode: number | null, timedOut: boolean, junit: JunitSummary | null): Grade {
  const failed = junit?.failures ?? 0;
  const errored = junit?.errors ?? 0;
  const total = junit?.tests ?? 0;
  const ran = Math.max(0, total - failed - errored - (junit?.skipped ?? 0));
  const passed = !timedOut && exitCode === 0 && failed + errored === 0 && ran > 0;
  return {
    passed,
    testsPassed: ran,
    testsFailed: failed,
    testsErrored: errored,
    failureReason: passed ? null : timedOut ? "timeout" : failed + errored === 0 && ran === 0 ? "no_tests_ran" : "tests_failed",
  };
}

export interface Testcase {
  classname: string;
  name: string;
  body: string;
}

export function testcases(xml: string): Testcase[] {
  return [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => ({
    classname: /\bclassname="([^"]*)"/.exec(m[1])?.[1] ?? "",
    name: /\bname="([^"]*)"/.exec(m[1])?.[1] ?? "",
    body: m[2] ?? "",
  }));
}

/** Failures that mean the code never got tested, rather than that it gave a wrong answer. */
const NOT_A_VERDICT = /^(?:E\s+)?(?:ModuleNotFoundError|ImportError|SyntaxError|IndentationError|NameError)\b/;

/**
 * Tests in `testFiles` that ran and failed a real check. The repo's own tests are ignored: `pytest -q` runs them too, and
 * an unrelated broken test says nothing about the hidden tests.
 */
export function realFailures(xml: string, testFiles: string[]): number {
  const modules = testFiles.filter((f) => f.endsWith(".py")).map((f) => f.slice(0, -3).replaceAll("/", "."));
  let count = 0;
  for (const { classname, body } of testcases(xml)) {
    if (!modules.some((mod) => classname === mod || classname.startsWith(`${mod}.`))) continue;
    const failure = /<failure\b[^>]*?\bmessage="([^"]*)"/.exec(body);
    if (failure && !NOT_A_VERDICT.test(failure[1])) count++;
  }
  return count;
}
