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
  failureReason: "tests_failed" | "timeout" | "patch_did_not_apply" | null;
}

/** passed = exit code 0, no failures or errors, and at least one test actually ran. */
export function grade(exitCode: number | null, timedOut: boolean, junit: JunitSummary | null): Grade {
  const failed = junit?.failures ?? 0;
  const errored = junit?.errors ?? 0;
  const total = junit?.tests ?? 0;
  const ran = Math.max(0, total - failed - errored - (junit?.skipped ?? 0));
  const passed = !timedOut && exitCode === 0 && failed + errored === 0 && total > 0;
  return {
    passed,
    testsPassed: ran,
    testsFailed: failed,
    testsErrored: errored,
    failureReason: passed ? null : timedOut ? "timeout" : "tests_failed",
  };
}
