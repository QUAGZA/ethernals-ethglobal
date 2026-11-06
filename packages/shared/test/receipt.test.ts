import { describe, expect, it } from "vitest";
import {
  canonicalizeReceipt,
  capabilitiesFromReceipts,
  credentialFor,
  hashReceipt,
  receiptFromResult,
  verifyReceiptIntegrity,
  type ValidationReceipt,
} from "../src/receipt";
import { type Hex, type VerificationResult } from "../src/tasks";

const H = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;

const result: VerificationResult = {
  version: 1,
  jobId: "j1",
  taskId: "task_00842",
  chainTaskId: "7",
  repoUrl: "https://github.com/x/y",
  baseCommit: "a".repeat(40),
  patchHash: H(1),
  testsHash: H(2),
  passed: true,
  testsPassed: 18,
  testsFailed: 2,
  testsErrored: 0,
  failureReason: null,
  durationMs: 1200,
  logsHash: H(3),
  isolation: "docker",
  image: "img",
  startedAt: "2026-11-06T10:00:00.000Z",
  finishedAt: "2026-11-06T10:00:02.000Z",
  verifier: ("0x" + "ab".repeat(20)) as Hex,
  signature: "0x00",
};

const mk = (over: Partial<ValidationReceipt> = {}): ValidationReceipt => ({
  ...receiptFromResult(result, H(9), { agentId: "pixel.eth", specHash: H(4), inputHash: H(5) }),
  ...over,
});

describe("validation receipt", () => {
  it("projects a result: score is the pass percentage", () => {
    const r = mk();
    expect(r.tests_total).toBe(20);
    expect(r.score).toBe(90);
    expect(r.validation_status).toBe("passed");
    expect(r.output_hash).toBe(H(1));
  });

  it("canonical form is key-order independent and stable", () => {
    const a = mk();
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as ValidationReceipt;
    expect(canonicalizeReceipt(reordered)).toBe(canonicalizeReceipt(a));
    expect(canonicalizeReceipt(a).startsWith('{"agent_id":"pixel.eth","category":"code-fix"')).toBe(true);
    expect(hashReceipt(reordered)).toBe(hashReceipt(a));
  });

  it("rejects non-integer numbers", () => {
    expect(() => canonicalizeReceipt(mk({ score: 90.5 }))).toThrow();
  });

  it("verified when database hash and chain commitment both match", () => {
    const r = mk();
    const c = verifyReceiptIntegrity(r, hashReceipt(r), r.result_hash);
    expect(c.status).toBe("verified");
  });

  it("unanchored when the task is not settled yet (zero hash)", () => {
    const r = mk();
    expect(verifyReceiptIntegrity(r, hashReceipt(r), H(0)).status).toBe("unanchored");
    expect(verifyReceiptIntegrity(r, hashReceipt(r), null).status).toBe("unanchored");
  });

  it("invalid when the database receipt was tampered with", () => {
    const r = mk();
    const stored = hashReceipt(r);
    const c = verifyReceiptIntegrity({ ...r, score: 100 }, stored, r.result_hash);
    expect(c.status).toBe("invalid");
    expect(c.reasons[0]).toMatch(/database hash/);
  });

  it("invalid when the on-chain commitment differs", () => {
    const r = mk();
    expect(verifyReceiptIntegrity(r, hashReceipt(r), H(77)).status).toBe("invalid");
  });
});

describe("capabilities", () => {
  it("derives per-category records and credentials from receipts only", () => {
    const rs = [mk(), mk(), mk({ validation_status: "failed", score: 0 })];
    const [rec] = capabilitiesFromReceipts(rs);
    expect(rec).toMatchObject({ category: "code-fix", verified: 3, passed: 2, failed: 1, successRatePct: 67 });
    expect(credentialFor(rec)).toBe("bronze");
    expect(credentialFor({ ...rec, passed: 15, successRatePct: 90 })).toBe("gold");
    expect(credentialFor({ ...rec, passed: 0, successRatePct: 0 })).toBeNull();
  });
});
