import { beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("assistants");
});

const hireAsAgent = vi.hoisted(() => vi.fn());
vi.mock("../src/buyer", async (original) => ({ ...(await original<object>()), hireAsAgent }));

const { assistantRoster, checkAssistantBudget, isTextAgent, MAX_DIRECT_ASSISTANT_BUDGET_USDC, runWithAssistants } = await import("../src/assistants");
const { getMandate, insertMandate, listSpendEvents, upsertBrain, upsertChainAgent, upsertSpendAccount } = await import("../src/db");
const { encryptSecret } = await import("../src/crypto");
const { setNameraFactoryForTests } = await import("../src/spend");
const { agent, person } = await import("./_fixtures");
import type { Decision } from "../src/agent-sandbox";
import type { SpendGuard, SpendPolicyView } from "@ethernals/shared";

let n = 0;
function mandate(forward = true, subBudget = "200000", expiresIn = 60_000) {
  return insertMandate({ id: `mandate-${++n}`, hire_id: `hire-${n}`, forward: forward ? 1 : 0, sub_budget: subBudget, spent: "0", expires_at: new Date(Date.now() + expiresIn).toISOString() });
}

function setup(price = "100000") {
  const seller = agent(person(), { task_type: "summarize" });
  const helper = agent(person(), { task_type: "translate", base_price: price, description: "Translates text." });
  return { seller, helper };
}

const recruit = (name: string, input = "translate this"): Decision => ({ action: "recruit", agent: name, input, translateTo: "hi" });
const finish: Decision = { action: "finish", result: "final answer" };
const script = (...decisions: (Decision | null)[]) => {
  let i = 0;
  return async () => decisions[i++] ?? finish;
};

const paid = (quotedPrice = "0.100000") => ({ hireId: "sub-1", result: "done by assistant", quotedPrice, paymentTxId: "0.0.1@1.2", paymentUrl: null, subHire: null, discoveredVia: "local" });

beforeEach(() => hireAsAgent.mockReset());

describe("which agents qualify", () => {
  it("takes text agents, not code-fix, image or dormant ones", async () => {
    const { seller, helper } = setup();
    const coder = agent(person(), { task_type: "code-fix" });
    const imager = agent(person(), { task_type: "summarize" });
    upsertBrain({ agent_key: imager.key, api_key_enc: null, key_label: null, model: "m", model_type: "image", credit_neuron: "999999999999999999", spent_neuron: "0", earned_units: "0", credited_from_earnings_neuron: "0", last_request_id: null } as never);
    expect(isTextAgent(seller)).toBe(true);
    expect(isTextAgent(coder)).toBe(false);
    expect(isTextAgent(imager)).toBe(false);
    const roster = (await assistantRoster(seller)).map((c) => c.ensName);
    expect(roster).toContain(helper.ens_name);
    expect(roster).not.toContain(seller.ens_name);
    expect(roster).not.toContain(coder.ens_name);
    expect(roster).not.toContain(imager.ens_name);
  });

  it("skips on-chain agents whose endpoint doesn't answer", async () => {
    const { seller } = setup();
    upsertChainAgent({ name: "far.ethernals-test.eth", label: "far", key: `0x${"f".repeat(64)}`, description: "", endpoint: "http://localhost:3000/a/far/task", provider: null, task_type: "translate", brain: null, hedera_account: null, status: "private", records_at: new Date().toISOString(), checked_at: new Date().toISOString() });
    expect((await assistantRoster(seller)).map((c) => c.ensName)).not.toContain("far.ethernals-test.eth");
  });
});

describe("hiring assistants", () => {
  it("pays an assistant over x402 and charges the mandate", async () => {
    const { seller, helper } = setup();
    const m = mandate();
    hireAsAgent.mockResolvedValue(paid());
    const run = await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: script(recruit(helper.ens_name)) });
    expect(run.result).toBe("final answer");
    expect(run.assistants).toMatchObject([{ status: "done", agentEnsName: helper.ens_name, amount: "0.100000" }]);
    expect(hireAsAgent.mock.calls[0][0]).toMatchObject({ buyer: seller, targetEnsName: helper.ens_name, maxUnits: 200000n, parentHireId: m.hire_id, consent: { forward: false, subBudget: "0" } });
    expect(getMandate(m.id)!.spent).toBe("100000");
  });

  it("sends nothing without consent", async () => {
    const { seller, helper } = setup();
    const m = mandate(false);
    const run = await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: script(recruit(helper.ens_name)) });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(run.assistants[0]).toMatchObject({ status: "blocked", reason: "SUBHIRE_BLOCKED_NO_CONSENT" });
  });

  it("refuses an assistant above the sub-budget", async () => {
    const { seller, helper } = setup("300000");
    const m = mandate();
    const run = await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: script(recruit(helper.ens_name)) });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(run.assistants[0]).toMatchObject({ status: "blocked", reason: "SUBHIRE_BLOCKED_BUDGET" });
  });

  it("refuses after the mandate expires", async () => {
    const { seller, helper } = setup();
    const m = mandate(true, "200000", -1000);
    await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: script(recruit(helper.ens_name)) });
    expect(hireAsAgent).not.toHaveBeenCalled();
  });

  it("stops the budget being overspent across assistants", async () => {
    const { seller, helper } = setup();
    const m = mandate(true, "150000");
    hireAsAgent.mockResolvedValue(paid());
    const run = await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 3, plan: script(recruit(helper.ens_name, "one"), recruit(helper.ens_name, "two")) });
    expect(hireAsAgent).toHaveBeenCalledTimes(1);
    expect(run.assistants[1]).toMatchObject({ status: "blocked", reason: "SUBHIRE_BLOCKED_BUDGET" });
  });

  it("stops at the number of assistants the hirer allowed", async () => {
    const { seller, helper } = setup();
    const m = mandate(true, "900000");
    hireAsAgent.mockResolvedValue(paid());
    await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: script(recruit(helper.ens_name, "one"), recruit(helper.ens_name, "two"), recruit(helper.ens_name, "three")) });
    expect(hireAsAgent).toHaveBeenCalledTimes(1);
  });

  it("refuses the agent itself, agents off the list and repeats", async () => {
    const { seller, helper } = setup();
    const m = mandate(true, "900000");
    hireAsAgent.mockResolvedValue(paid());
    const run = await runWithAssistants({
      seller,
      hireId: m.hire_id,
      mandateId: m.id,
      input: "text",
      maxAssistants: 3,
      plan: script(recruit(seller.ens_name), recruit("attacker.eth"), recruit(helper.ens_name, "same"), recruit(helper.ens_name, "same")),
    });
    expect(hireAsAgent).toHaveBeenCalledTimes(1);
    expect(run.assistants.map((a) => a.status)).toEqual(["blocked", "blocked", "done", "blocked"]);
  });

  it("keeps what it has if a hire fails, and never charges for it", async () => {
    const { seller, helper } = setup();
    const m = mandate();
    const { AppError } = await import("../src/errors");
    hireAsAgent.mockRejectedValueOnce(new AppError(502, "Payment failed"));
    const run = await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: script(recruit(helper.ens_name)) });
    expect(run.assistants[0]).toMatchObject({ status: "failed", reason: "Payment failed" });
    expect(getMandate(m.id)!.spent).toBe("0");
  });

  it("gives up without paying when planning fails", async () => {
    const { seller } = setup();
    const m = mandate();
    const run = await runWithAssistants({ seller, hireId: m.hire_id, mandateId: m.id, input: "text", maxAssistants: 1, plan: async () => { throw new Error("0G down"); } });
    expect(run).toEqual({ result: null, notes: [], assistants: [] });
  });
});

describe("the hirer's spending controls", () => {
  const consent = (subBudget: string, forward = true) => ({ forward, subBudget, maxAssistants: 1 });

  function namera(policy: Partial<SpendPolicyView>) {
    const guard = {
      kind: "namera",
      address: async () => "0x0",
      execute: async () => { throw new Error("not used"); },
      policy: async () => ({ guard: "namera", accountAddress: "0x0", chainId: "eip155:11155111", sessionKeyId: "s", status: "active", allowedContracts: [], tokenAllowanceUsdc: "0.50", rateLimit: null, validUntil: null, source: "namera-api", ...policy }),
    } as unknown as SpendGuard;
    setNameraFactoryForTests(() => guard);
    const owner = person();
    upsertSpendAccount({ person_id: owner.id, api_key_enc: encryptSecret("key"), wallet_id: "w", session_key_id: "s", wallet_address: "0x0" } as never);
    return { owner, buyer: agent(owner, { kind: "buyer", task_type: null }) };
  }

  it("needs consent and a real budget", async () => {
    const owner = person();
    const buyer = agent(owner, { kind: "buyer", task_type: null });
    await expect(checkAssistantBudget(owner, buyer, consent("0.10", false))).rejects.toThrow(/allow sharing/);
    await expect(checkAssistantBudget(owner, buyer, consent("0"))).rejects.toThrow(/above 0/);
  });

  it("does nothing when assistants are off", async () => {
    const owner = person();
    await expect(checkAssistantBudget(owner, agent(owner, { kind: "buyer", task_type: null }), { forward: false, subBudget: "99" })).resolves.toBeUndefined();
  });

  it("applies the server limit without Namera and records the block", async () => {
    setNameraFactoryForTests(null);
    const owner = person();
    const buyer = agent(owner, { kind: "buyer", task_type: null });
    await expect(checkAssistantBudget(owner, buyer, consent(MAX_DIRECT_ASSISTANT_BUDGET_USDC))).resolves.toBeUndefined();
    await expect(checkAssistantBudget(owner, buyer, consent("1.01"))).rejects.toThrow(/server limit/);
    expect(listSpendEvents(owner.id, 5)[0]).toMatchObject({ status: "blocked", rule: "direct-cap", guard: "direct" });
  });

  it("holds the sub-budget to the Namera cap", async () => {
    const { owner, buyer } = namera({});
    await expect(checkAssistantBudget(owner, buyer, consent("0.50"))).resolves.toBeUndefined();
    await expect(checkAssistantBudget(owner, buyer, consent("0.51"))).rejects.toThrow(/Namera cap/);
    expect(listSpendEvents(owner.id, 5)[0]).toMatchObject({ status: "blocked", rule: "namera-cap", guard: "namera" });
  });

  it("refuses a revoked or expired session key", async () => {
    const revoked = namera({ status: "revoked" });
    await expect(checkAssistantBudget(revoked.owner, revoked.buyer, consent("0.10"))).rejects.toThrow(/revoked/);
    const expired = namera({ validUntil: new Date(Date.now() - 1000).toISOString() });
    await expect(checkAssistantBudget(expired.owner, expired.buyer, consent("0.10"))).rejects.toThrow(/expired/);
  });
});
