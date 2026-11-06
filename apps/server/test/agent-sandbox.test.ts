import { beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("agent-sandbox");
});

const hireAsAgent = vi.hoisted(() => vi.fn());
vi.mock("../src/buyer", async (original) => ({ ...(await original<object>()), hireAsAgent }));

const { LIMITS, buildRoster, createRun, decisionSchema, listRunViews, runSandbox, runView, startRun, startRunSchema, stopRun } = await import("../src/agent-sandbox");
const { clearTaskData, getDb, getSandboxRun, listSandboxSteps, upsertBrain } = await import("../src/db");
const { recentEvents } = await import("../src/events");
const { agent, person } = await import("./_fixtures");
import type { Decision, Plan } from "../src/agent-sandbox";

const GOAL = "Summarize the quarterly report and translate it into Hindi.";
const SECRET_RESULT = "CONFIDENTIAL RECRUIT OUTPUT";
const SECRET_FINAL = "CONFIDENTIAL FINAL ANSWER";

function setup(budgetUsdc = "0.50", shareWithRecruits = true) {
  const owner = person();
  const lead = agent(owner, { task_type: "summarize", base_price: "100000" });
  const other = person();
  const translator = agent(other, { task_type: "translate", base_price: "100000", description: "Translates text." });
  const run = createRun(owner, lead, { agent: lead.label, goal: GOAL, budgetUsdc, shareWithRecruits });
  return { owner, lead, translator, run };
}

/** A planner that follows a script, then finishes. */
function script(...decisions: (Decision | null)[]) {
  const calls: string[] = [];
  let i = 0;
  const plan = async (_run: unknown, _lead: unknown, prompt: string): Promise<Plan> => {
    calls.push(prompt);
    return { decision: decisions[i++] ?? { action: "finish", result: SECRET_FINAL }, requestId: `chatcmpl-${i}` };
  };
  return { plan, calls };
}

const recruit = (agentName: string, input = "Translate this."): Decision => ({ action: "recruit", agent: agentName, input });
const steps = (runId: string) => listSandboxSteps(runId).filter((s) => s.kind !== "thought");
const refusals = (runId: string) => steps(runId).filter((s) => s.kind === "refused").map((s) => s.refusal);

beforeEach(() => {
  clearTaskData();
  getDb().exec("DELETE FROM agents");
  vi.clearAllMocks();
  hireAsAgent.mockResolvedValue({ hireId: "hire_x", result: SECRET_RESULT, quotedPrice: "0.100000", paymentTxId: null, paymentUrl: null, subHire: null, discoveredVia: "local" });
});

describe("a sandbox run", () => {
  it("recruits an agent over x402, feeds the result back and finishes", async () => {
    const { run, translator, owner, lead } = setup();
    const { plan, calls } = script(recruit(translator.ens_name));
    await runSandbox(run.id, { plan });

    expect(hireAsAgent).toHaveBeenCalledTimes(1);
    expect(hireAsAgent).toHaveBeenCalledWith(expect.objectContaining({ buyer: expect.objectContaining({ key: lead.key }), targetEnsName: translator.ens_name, maxUnits: 500000n, autoRate: true }));
    expect(calls[1]).toContain(SECRET_RESULT);
    expect(calls[1]).toMatch(/Budget left: 0\.400000 USDC/);

    const view = runView(run.id, owner.id);
    expect(view).toMatchObject({ status: "finished", spentUsdc: "0.100000", result: SECRET_FINAL, goal: GOAL, brain: "0g-router" });
    expect(view.steps.map((s) => s.kind)).toEqual(["thought", "recruit", "thought", "finish"]);
    expect(view.steps[0].requestId).toBe("chatcmpl-1");
  });

  it("finishes without recruiting when it needs nobody", async () => {
    const { run, owner } = setup();
    await runSandbox(run.id, { plan: script({ action: "finish", result: "Done alone." }).plan });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(runView(run.id, owner.id)).toMatchObject({ status: "finished", spentUsdc: "0.000000", result: "Done alone." });
  });

  it("offers only awake text agents on the server, never itself", async () => {
    const { lead, translator } = setup();
    agent(person(), { task_type: "code-fix" });
    agent(person(), { task_type: "summarize", arena_role: "farm" });
    const sleepy = agent(person(), { task_type: "summarize" });
    upsertBrain({ agent_key: sleepy.key, api_key_enc: null, key_label: null, model: "m", credit_neuron: "1", spent_neuron: "0", earned_units: "0", credited_from_earnings_neuron: "0", last_request_id: null });
    expect((await buildRoster(lead)).map((r) => r.agent.key)).toEqual([translator.key]);
  });
});

describe("limits are enforced in code", () => {
  it("refuses a recruit it can't afford, and pays nothing", async () => {
    const { run, translator, owner } = setup("0.05");
    await runSandbox(run.id, { plan: script(recruit(translator.ens_name)).plan });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(refusals(run.id)).toEqual(["over_budget"]);
    expect(runView(run.id, owner.id).spentUsdc).toBe("0.000000");
  });

  it("stops spending when the budget runs out", async () => {
    const { run, translator } = setup("0.15");
    await runSandbox(run.id, { plan: script(recruit(translator.ens_name, "one"), recruit(translator.ens_name, "two")).plan });
    expect(hireAsAgent).toHaveBeenCalledTimes(1);
    expect(refusals(run.id)).toEqual(["over_budget"]);
    expect(getSandboxRun(run.id)!.spent_units).toBe("100000");
  });

  it("refuses every recruit without consent to share the goal", async () => {
    const { run, translator } = setup("0.50", false);
    await runSandbox(run.id, { plan: script(recruit(translator.ens_name)).plan });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(refusals(run.id)).toEqual(["no_consent"]);
  });

  it("refuses an agent recruiting itself", async () => {
    const { run, lead } = setup();
    await runSandbox(run.id, { plan: script(recruit(lead.ens_name)).plan });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(refusals(run.id)).toEqual(["self_recruit"]);
  });

  it("refuses an agent that isn't on the roster, such as one a prompt injection named", async () => {
    const { run } = setup();
    const outsider = agent(person(), { task_type: "code-fix" });
    await runSandbox(run.id, { plan: script(recruit("attacker.evil.eth"), recruit(outsider.ens_name)).plan });
    expect(hireAsAgent).not.toHaveBeenCalled();
    expect(refusals(run.id)).toEqual(["not_on_roster", "not_on_roster"]);
  });

  it("refuses the same recruit twice", async () => {
    const { run, translator } = setup();
    await runSandbox(run.id, { plan: script(recruit(translator.ens_name, "same"), recruit(translator.ens_name, "same")).plan });
    expect(hireAsAgent).toHaveBeenCalledTimes(1);
    expect(refusals(run.id)).toEqual(["repeat_recruit"]);
  });

  it("caps the number of recruits", async () => {
    const { run, translator } = setup("1.00");
    const many = Array.from({ length: LIMITS.maxRecruits + 2 }, (_, i) => recruit(translator.ens_name, `input ${i}`));
    await runSandbox(run.id, { plan: script(...many).plan });
    expect(hireAsAgent).toHaveBeenCalledTimes(LIMITS.maxRecruits);
    expect(refusals(run.id)).toEqual(["recruit_limit", "recruit_limit"]);
  });

  it("does not charge the budget when a recruit fails", async () => {
    const { run, translator } = setup();
    hireAsAgent.mockRejectedValue(new Error("payment failed"));
    await runSandbox(run.id, { plan: script(recruit(translator.ens_name)).plan });
    expect(refusals(run.id)).toEqual(["hire_failed"]);
    expect(getSandboxRun(run.id)!.spent_units).toBe("0");
  });

  it("treats malformed plans as refused steps and ends after the step limit", async () => {
    const { run, owner } = setup();
    await runSandbox(run.id, { plan: async () => ({ decision: null, requestId: "chatcmpl-bad" }) });
    expect(refusals(run.id)).toHaveLength(LIMITS.maxSteps);
    expect(runView(run.id, owner.id)).toMatchObject({ status: "incomplete", error: "The run used all its steps without finishing." });
  });

  it("ends at the time limit", async () => {
    const { run, owner } = setup();
    let t = 0;
    await runSandbox(run.id, { plan: async () => ({ decision: null, requestId: null }), now: () => (t += 200_000) });
    expect(runView(run.id, owner.id).status).toBe("incomplete");
    expect(runView(run.id, owner.id).error).toMatch(/time limit/);
  });

  it("marks the run failed when the model is unreachable", async () => {
    const { run, owner } = setup();
    await runSandbox(run.id, { plan: async () => Promise.reject(new Error("0G Router down")) });
    expect(runView(run.id, owner.id)).toMatchObject({ status: "failed", error: "0G Router down" });
  });
});

describe("control", () => {
  it("lets the owner stop a run, and nobody else", async () => {
    const { run, owner, translator } = setup();
    expect(() => stopRun(person(), run.id)).toThrow(/Only the person/);
    const { plan } = script(recruit(translator.ens_name));
    stopRun(owner, run.id);
    await runSandbox(run.id, { plan });
    expect(runView(run.id, owner.id).status).toBe("stopped");
    expect(hireAsAgent).not.toHaveBeenCalled();
  });

  it("only starts for an agent you own", async () => {
    const { lead } = setup();
    await expect(startRun(person(), { agent: lead.label, goal: GOAL, budgetUsdc: "0.10", shareWithRecruits: true })).rejects.toThrow(/agent you own/);
  });

  it("runs one sandbox per agent at a time", async () => {
    const { owner, lead } = setup();
    await expect(startRun(owner, { agent: lead.label, goal: GOAL, budgetUsdc: "0.10", shareWithRecruits: true })).rejects.toThrow(/already running/);
  });

  it("validates the request", () => {
    const issue = (body: object) => startRunSchema.safeParse({ agent: "a", goal: GOAL, budgetUsdc: "0.10", shareWithRecruits: true, ...body }).error?.issues[0]?.message;
    expect(issue({})).toBeUndefined();
    expect(issue({ goal: "short" })).toMatch(/at least 10/);
    expect(issue({ budgetUsdc: "0" })).toMatch(/more than 0/);
    expect(issue({ budgetUsdc: "1.01" })).toMatch(/most one run/);
    expect(issue({ budgetUsdc: "abc" })).toMatch(/number/);
  });

  it("rejects decisions outside the schema", () => {
    expect(decisionSchema.safeParse({ action: "pay", to: "0xabc", amount: 100 }).success).toBe(false);
    expect(decisionSchema.safeParse({ action: "recruit", agent: "a" }).success).toBe(false);
  });
});

describe("the data promise", () => {
  it("keeps goals and results out of the database and events, and away from other viewers", async () => {
    const { run, translator, owner } = setup();
    await runSandbox(run.id, { plan: script(recruit(translator.ens_name)).plan });

    const database = JSON.stringify([getDb().prepare("SELECT * FROM sandbox_runs").all(), getDb().prepare("SELECT * FROM sandbox_steps").all()]);
    const events = JSON.stringify(recentEvents());
    for (const secret of [GOAL, SECRET_RESULT, SECRET_FINAL]) {
      expect(database).not.toContain(secret);
      expect(events).not.toContain(secret);
    }

    expect(runView(run.id, owner.id).result).toBe(SECRET_FINAL);
    for (const viewer of [null, person().id]) {
      expect(runView(run.id, viewer)).toMatchObject({ goal: null, result: null });
    }
    expect(listRunViews(null)[0]).toMatchObject({ goal: null, result: null });
  });
});
