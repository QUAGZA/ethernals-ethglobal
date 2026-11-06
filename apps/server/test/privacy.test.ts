import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.PERSON_HASH_SECRET = "test-person-secret";
  process.env.KEYSTORE_SECRET = "test-keystore-secret";
  process.env.SESSION_SECRET = "test-session-secret";
});

describe("person hashes (PRD §6.1)", async () => {
  const { personHash, providerKey } = await import("../src/crypto");
  const agentA = "0x" + "a".repeat(64);
  const agentB = "0x" + "b".repeat(64);

  it("match only for the same person on the same agent", () => {
    expect(personHash("alice", agentA)).toBe(personHash("alice", agentA));
    expect(personHash("alice", agentA)).not.toBe(personHash("bob", agentA));
  });

  it("cannot link one person across two agents", () => {
    expect(personHash("alice", agentA)).not.toBe(personHash("alice", agentB));
  });

  it("gives each provider one stable public key", () => {
    expect(providerKey("alice")).toBe(providerKey("alice"));
    expect(providerKey("alice")).not.toBe(providerKey("bob"));
    expect(providerKey("alice")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("keys at rest and sessions", async () => {
  const { decryptSecret, encryptSecret, createSessionToken, readSessionToken } = await import("../src/crypto");

  it("round-trips encrypted keys and never stores plaintext", () => {
    const secret = "0x" + "1".repeat(64);
    const blob = encryptSecret(secret);
    expect(blob).not.toContain("1111");
    expect(decryptSecret(blob)).toBe(secret);
  });

  it("rejects tampered session tokens", () => {
    const token = createSessionToken("person_1");
    expect(readSessionToken(token)).toBe("person_1");
    const [id, exp, sig] = token.split(".");
    expect(readSessionToken(`${id}x.${exp}.${sig}`)).toBeNull();
    expect(readSessionToken(`${id}.${Number(exp) + 1}.${sig}`)).toBeNull();
  });
});

describe("sandbox (PRD SEC-1, SEC-3)", async () => {
  const { createSafeFetch, EgressBlockedError, withWorkspace } = await import("../src/sandbox");

  it("deletes the per-hire workspace after success", async () => {
    let dir = "";
    await withWorkspace("hire_test_ok", async (d) => {
      dir = d;
      fs.writeFileSync(`${d}/input.txt`, "private");
    });
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("deletes the per-hire workspace after failure", async () => {
    let dir = "";
    await expect(
      withWorkspace("hire_test_fail", async (d) => {
        dir = d;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("blocks outbound requests to hosts that are not allowlisted", async () => {
    const safeFetch = createSafeFetch([], { hireId: "hire_x" });
    await expect(safeFetch("https://evil.example.com/steal")).rejects.toBeInstanceOf(EgressBlockedError);
  });
});

describe("small parsers", async () => {
  const { normalizeNullifier } = await import("../src/identity");
  const { sellerLabelFromPath } = await import("../src/payments");
  const { normalizeEcdsaKey } = await import("../src/config");

  it("treats hex and decimal nullifiers as the same person", () => {
    expect(normalizeNullifier("0x10")).toBe("16");
    expect(normalizeNullifier("16")).toBe("16");
  });

  it("reads the agent label from the x402 route", () => {
    expect(sellerLabelFromPath("/a/summarize/task")).toBe("summarize");
    expect(sellerLabelFromPath("/a/../task")).toBeNull();
  });

  it("normalizes raw and DER-encoded ECDSA keys", () => {
    const raw = "ab".repeat(32);
    expect(normalizeEcdsaKey(raw)).toBe(`0x${raw}`);
    expect(normalizeEcdsaKey(`0x${raw}`)).toBe(`0x${raw}`);
    expect(normalizeEcdsaKey(`3030020100300706052b8104000a04220420${raw}`)).toBe(`0x${raw}`);
    expect(() => normalizeEcdsaKey("nope")).toThrow();
  });
});

describe("batched ledger writes (PRD LED-4)", async () => {
  const { Batcher, SerialQueue } = await import("../src/queue");

  it("flushes many items in one batch and resolves each with its own result", async () => {
    const batches: number[][] = [];
    const batcher = new Batcher<number, number>(async (items) => {
      batches.push(items);
      return items.map((i) => i * 10);
    }, 25, 20);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => batcher.add(i)));
    expect(results[7]).toBe(70);
    expect(batches.length).toBe(1);
  });

  it("runs writes one at a time", async () => {
    const q = new SerialQueue();
    const order: string[] = [];
    await Promise.all([
      q.run(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("first");
      }),
      q.run(async () => {
        order.push("second");
      }),
    ]);
    expect(order).toEqual(["first", "second"]);
  });
});
