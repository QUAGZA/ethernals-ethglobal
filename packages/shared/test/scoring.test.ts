import { describe, expect, it } from "vitest";
import {
  formatPriceShort,
  formatScore,
  formatUnits6,
  parseUnits6,
  priceOf,
  scoreX1e6,
} from "../src/scoring";
import { hashscanTxUrl, toMirrorTxId } from "../src/links";
import { LEDGER_REASONS, isCountedReason, reasonFromIndex } from "../src/reasons";
import { assertValidLabel } from "../src/ens-keys";

const BASE = 100000n; // 0.10 USDC

describe("scoring matches the PRD worked example (§6.3)", () => {
  const rows: [votes: number, sum: number, score: string, price: string][] = [
    [0, 0, "3.00", "0.100000"],
    [1, 5, "3.50", "0.116666"],
    [2, 10, "3.80", "0.126666"],
    [2, 9, "3.60", "0.120000"],
    [3, 14, "3.83", "0.127777"],
  ];
  for (const [votes, sum, score, price] of rows) {
    it(`votes=${votes} sum=${sum} -> score ${score}, price ${price}`, () => {
      expect(formatScore(scoreX1e6(votes, sum))).toBe(score);
      expect(formatUnits6(priceOf(BASE, votes, sum))).toBe(price);
    });
  }

  it("keeps price within 1/3 and 5/3 of base", () => {
    expect(priceOf(BASE, 1000, 1000)).toBeGreaterThan(BASE / 3n);
    expect(priceOf(BASE, 1000, 5000)).toBeLessThan((BASE * 5n) / 3n);
  });
});

describe("units", () => {
  it("parses and formats 6-decimal amounts", () => {
    expect(parseUnits6("0.10")).toBe(100000n);
    expect(parseUnits6("1")).toBe(1_000_000n);
    expect(formatUnits6(116666n)).toBe("0.116666");
    expect(formatPriceShort(116666n)).toBe("0.117");
    expect(() => parseUnits6("0.1234567")).toThrow();
    expect(() => parseUnits6("-1")).toThrow();
  });
});

describe("hedera tx ids", () => {
  it("normalizes SDK and mirror forms", () => {
    expect(toMirrorTxId("0.0.123@1700000000.5")).toBe("0.0.123-1700000000-000000005");
    expect(toMirrorTxId("0.0.123-1700000000-000000005")).toBe("0.0.123-1700000000-000000005");
    expect(hashscanTxUrl("0.0.123@1700000000.5")).toBe(
      "https://hashscan.io/testnet/transactionsById/0.0.123-1700000000-000000005",
    );
    expect(() => toMirrorTxId("0xabc")).toThrow();
  });
});

describe("reasons", () => {
  it("keeps the ledger enum order", () => {
    expect(LEDGER_REASONS.indexOf("COUNTED")).toBe(0);
    expect(reasonFromIndex(2)).toBe("SAME_PERSON");
    expect(isCountedReason("COUNTED_REPLACED_VOTE")).toBe(true);
    expect(isCountedReason("SAME_PERSON")).toBe(false);
  });
});

describe("labels", () => {
  it("accepts simple labels and rejects bad ones", () => {
    expect(() => assertValidLabel("summarize")).not.toThrow();
    expect(() => assertValidLabel("bob-buyer")).not.toThrow();
    expect(() => assertValidLabel("-bad")).toThrow();
    expect(() => assertValidLabel("Bad")).toThrow();
    expect(() => assertValidLabel("a.b")).toThrow();
  });
});
