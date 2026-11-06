import { beforeEach, describe, expect, it } from "vitest";

await (async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("namera-guard");
})();

const { blockRule, createNameraGuard } = await import("../src/namera-guard");
import type { NameraLike, NameraPermission } from "../src/namera-guard";
import type { Hex } from "@ethernals/shared";

const TOKEN = "0x00000000000000000000000000000000000000E2";
const ok = <T,>(data: T) => ({ success: true as const, data, error: null });
const fail = (message: string, extra: object = {}) => ({ success: false as const, data: null, error: { message, ...extra } });
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

type Overrides = Partial<{ permissions: object[]; keyStatus: string; installStatus: string; chainId: string; validUntil: number; walletId: string; custody: string; execute: unknown; getStatus: unknown; keyGet: unknown }>;

/** Mirrors the SDK's real response: authorization sits on the installation, the address on the wallet. */
function client(overrides: Overrides = {}): NameraLike {
  const { permissions = [{ type: "erc20-token-transfer", address: TOKEN, allowance: 10_000_000n }, { type: "contract-access", address: "0xabc" }], keyStatus = "active", installStatus = "installed", chainId = "eip155:11155111", validUntil = FUTURE, walletId = "w", custody = "namera-managed" } = overrides;
  return {
    sessionKeys: { get: overrides.keyGet ?? (async () => ok({ status: keyStatus, signer: { custody }, wallet: { id: walletId, address: "0xaccount" }, installations: [{ chainId, status: installStatus, authorization: { permissions, validUntil } }] })) },
    executions: {
      execute: overrides.execute ?? (async () => ok({ status: "submitted", submissionId: "sub" })),
      getStatus: overrides.getStatus ?? (async () => ok({ status: "confirmed", execution: { data: { transactionHash: "0xtx" } } })),
    },
  } as unknown as NameraLike;
}

const guard = (c: NameraLike) => createNameraGuard({ apiKey: "k", walletId: "w", sessionKeyId: "s", client: c, pollMs: 1, pollLimitMs: 30 });
const request = { chainId: "eip155:11155111" as const, calls: [{ to: "0xabc" as Hex, data: "0x" as Hex, value: "0" }], purpose: "fund", amountUsdc: "2" };

describe("reading the policy", () => {
  beforeEach(() => {
    process.env.MOCK_USDC_ADDRESS = TOKEN;
  });

  it("maps the Sepolia installation", async () => {
    const policy = await guard(client()).policy();
    expect(policy).toMatchObject({ guard: "namera", accountAddress: "0xaccount", status: "active", tokenAllowanceUsdc: "10.000000", allowedContracts: ["0xabc"], rateLimit: null, source: "namera-api" });
    expect(policy.validUntil).toBe(new Date(FUTURE * 1000).toISOString());
  });

  it("has no cap when the key has no limit on tUSDC", async () => {
    expect((await guard(client({ permissions: [{ type: "root" }] })).policy()).tokenAllowanceUsdc).toBeNull();
  });

  it("reports revoked, expired and uninstalled keys", async () => {
    expect((await guard(client({ keyStatus: "revoked" })).policy()).status).toBe("revoked");
    expect((await guard(client({ installStatus: "revoking" })).policy()).status).toBe("revoked");
    expect((await guard(client({ validUntil: FUTURE - 7200 })).policy()).status).toBe("expired");
    expect((await guard(client({ installStatus: "pending" })).policy()).status).toBe("unknown");
  });

  it("refuses a key that isn't on Sepolia", async () => {
    await expect(guard(client({ chainId: "eip155:8453" })).policy()).rejects.toThrow(/Sepolia/);
  });

  it("refuses a key from another account", async () => {
    await expect(guard(client({ walletId: "other" })).policy()).rejects.toThrow(/different account/);
  });

  it("refuses a key the server can't sign with", async () => {
    await expect(guard(client({ custody: "local" })).policy()).rejects.toThrow(/own machine/);
  });

  it("says what is wrong with the values", async () => {
    await expect(guard(client({ keyGet: async () => fail("x", { kind: "contract" }) })).policy()).rejects.toThrow(/Namera's format/);
    await expect(guard(client({ keyGet: async () => fail("x", { status: 401 }) })).policy()).rejects.toThrow(/API key/);
    await expect(guard(client({ keyGet: async () => fail("x", { status: 403 }) })).policy()).rejects.toThrow(/can't read/);
    await expect(guard(client({ keyGet: async () => fail("The session key was not found.", { status: 404 }) })).policy()).rejects.toThrow(/not found/);
  });
});

describe("executing", () => {
  it("sends values as bigints, which the SDK requires", async () => {
    let sent: { calls: { value: unknown }[] } | undefined;
    const c = client({ execute: async (input: typeof sent) => { sent = input; return ok({ status: "submitted", submissionId: "sub" }); } });
    await guard(c).execute(request);
    expect(sent!.calls[0].value).toBe(0n);
  });

  it("polls until confirmed", async () => {
    let n = 0;
    const c = client({ getStatus: async () => (++n < 3 ? ok({ status: "submitted" }) : ok({ status: "confirmed", execution: { data: { transactionHash: "0xlater" } } })) });
    expect(await guard(c).execute(request)).toMatchObject({ status: "confirmed", txHash: "0xlater" });
  });

  it("returns a policy violation as a block, not an error", async () => {
    const c = client({ execute: async () => fail("Token allowance exceeded") });
    expect(await guard(c).execute(request)).toEqual({ status: "blocked", guard: "namera", reason: "Token allowance exceeded", rule: "token-allowance" });
  });

  it("treats other errors and timeouts as failures", async () => {
    expect(await guard(client({ execute: async () => fail("Bad gateway") })).execute(request)).toMatchObject({ status: "failed", error: "Bad gateway" });
    expect(await guard(client({ getStatus: async () => ok({ status: "failed" }) })).execute(request)).toMatchObject({ status: "failed" });
    expect(await guard(client({ getStatus: async () => ok({ status: "submitted" }) })).execute(request)).toMatchObject({ status: "failed", error: expect.stringMatching(/in time/) });
  });

  it("never throws", async () => {
    const c = client({ execute: async () => { throw new Error("boom\nsecret stack"); } });
    expect(await guard(c).execute(request)).toEqual({ status: "failed", guard: "namera", error: "boom" });
  });
});

describe("classifying errors", () => {
  it.each([
    [{ message: "allowance exceeded" }, "token-allowance"],
    [{ message: "contract not allowed" }, "contract-access"],
    [{ message: "session key expired" }, "expired"],
    [{ message: "key revoked" }, "expired"],
    [{ message: "permission denied" }, "policy"],
    [{ tag: "RateLimitExceeded", message: "slow down" }, null],
    [{ message: "network down" }, null],
  ])("%j -> %s", (error, rule) => {
    expect(blockRule(error)).toBe(rule);
  });
});
