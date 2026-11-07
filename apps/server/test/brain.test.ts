import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { setTestEnv } = await import("./_env");
  setTestEnv("brain");
});

const { brainView, chooseModel, clearModelCache, creditEarnings, costOf, createAgentKey, currentModelId, extractLastJson, isDormant, loadModels, neuronForEarnings, setRetryDelayForTests, spinUpBrain, think } = await import("../src/brain");
const { getBrain, listReceipts, upsertBrain } = await import("../src/db");
const { encryptSecret } = await import("../src/crypto");
const { agentGate } = await import("../src/gate");
const { recentEvents } = await import("../src/events");
const { agent, person } = await import("./_fixtures");

const MODELS = {
  data: [
    { id: "cheap", pricing: { prompt: "1", completion: "1" }, supported_parameters: ["response_format"], verifiability: "TeeML" },
    { id: "pricey", pricing: { prompt: "9", completion: "9" }, supported_parameters: ["response_format"], verifiability: "TeeML" },
    { id: "0gm-1.0-35b-a3b", pricing: { prompt: "2", completion: "3" }, supported_parameters: ["response_format", "reasoning_effort"], verifiability: "TeeML" },
    { id: "open", pricing: { prompt: "0", completion: "1" }, supported_parameters: ["response_format"], verifiability: "none" },
  ],
};

const chat = (content: string, id = "chatcmpl-1", status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ id, choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status, headers });

type Handler = (url: string, init?: RequestInit) => Response;

function stubRouter(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/models")) return new Response(JSON.stringify(MODELS));
    return handler(String(input), init);
  });
  return calls;
}

type Call = { url: string; init?: RequestInit };
const chatCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/chat/completions"));
const auth = (c: Call) => (c.init?.headers as Record<string, string>).authorization;
const trustMode = (c: Call) => (c.init?.headers as Record<string, string>)["X-0G-Provider-Trust-Mode"];
const messages = [{ role: "user" as const, content: "hi" }];

beforeEach(() => {
  clearModelCache();
  setRetryDelayForTests(1);
});
afterEach(() => vi.unstubAllGlobals());

describe("choosing a model", () => {
  const withoutOwnModel = MODELS.data.filter((m) => m.id !== "0gm-1.0-35b-a3b");

  it("prefers ZG_MODEL, then 0G's own model, then the cheapest sealed JSON model", () => {
    expect(chooseModel(MODELS.data, "open").id).toBe("open");
    expect(chooseModel(MODELS.data, null).id).toBe("0gm-1.0-35b-a3b");
    expect(chooseModel(withoutOwnModel, null).id).toBe("cheap");
  });

  it("skips 0G's own model when it has no sealed provider", () => {
    const unsealed = MODELS.data.map((m) => (m.id === "0gm-1.0-35b-a3b" ? { ...m, verifiability: "none" } : m));
    expect(chooseModel(unsealed, null).id).toBe("cheap");
  });

  it("refuses to pick when no model is sealed", async () => {
    const open = MODELS.data.filter((m) => m.id === "open");
    expect(() => chooseModel(open, null)).toThrow(/no sealed model/);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: open })));
    await loadModels();
    expect(currentModelId()).toBe("0gm-1.0-35b-a3b");
  });

  it("prices a call from the model's per-token rates", () => {
    expect(costOf(MODELS.data[2], 10, 20)).toBe(80n);
  });
});

describe("reading answers", () => {
  it("takes the last JSON object from a thinking model's output", () => {
    const text = 'First {"files": []} was wrong, and a stray { brace. Final answer: {"files": [{"path": "a.py"}], "explanation": "fixed }"}';
    expect(extractLastJson(text)).toEqual({ files: [{ path: "a.py" }], explanation: "fixed }" });
  });

  it("rejects output with no JSON", () => {
    expect(() => extractLastJson("no json here")).toThrow(/no JSON/);
  });
});

describe("think", () => {
  it("records a receipt, computes the cost and spends the agent's credit", async () => {
    const calls = stubRouter(() => chat("hello", "chatcmpl-abc", 200, { "x-0g-provider-address": "0xprovider" }));
    const seller = agent(person());
    const { text, receipt } = await think(seller, { purpose: "summarize", taskId: "task_1", messages });

    expect(text).toBe("hello");
    expect(receipt).toMatchObject({ requestId: "chatcmpl-abc", provider: "0xprovider", promptTokens: 10, completionTokens: 20, costNeuron: "80", taskId: "task_1", agentEnsName: seller.ens_name });
    expect(getBrain(seller.key)).toMatchObject({ credit_neuron: "920", spent_neuron: "80", last_request_id: "chatcmpl-abc" });
    expect(listReceipts(seller.key)).toHaveLength(1);
    expect(recentEvents().some((e) => e.type === "inference.receipt" && e.data.requestId === "chatcmpl-abc")).toBe(true);

    const body = JSON.parse(chatCalls(calls)[0].init!.body as string);
    expect(body.max_tokens).toBeGreaterThanOrEqual(4000);
    expect(body.reasoning_effort).toBe("low");
  });

  it("never stores the prompt or the completion", async () => {
    stubRouter(() => chat("secret completion"));
    const seller = agent(person());
    await think(seller, { purpose: "code-fix", messages: [{ role: "user", content: "secret prompt" }] });
    const stored = JSON.stringify(listReceipts(seller.key));
    expect(stored).not.toContain("secret prompt");
    expect(stored).not.toContain("secret completion");
  });

  it("asks for JSON and returns the last object", async () => {
    const calls = stubRouter(() => chat('thinking... {"a":1} then {"a":2}'));
    const { json } = await think(agent(person()), { purpose: "code-fix", json: true, messages });
    expect(json).toEqual({ a: 2 });
    expect(JSON.parse(chatCalls(calls)[0].init!.body as string).response_format).toEqual({ type: "json_object" });
  });

  it("retries once on a 429", async () => {
    let n = 0;
    const calls = stubRouter(() => (++n === 1 ? new Response("slow down", { status: 429 }) : chat("ok")));
    expect((await think(agent(person()), { purpose: "summarize", messages })).text).toBe("ok");
    expect(chatCalls(calls)).toHaveLength(2);
  });

  it("gives up after the retry", async () => {
    const calls = stubRouter(() => new Response("down", { status: 503 }));
    await expect(think(agent(person()), { purpose: "summarize", messages })).rejects.toThrow(/503/);
    expect(chatCalls(calls)).toHaveLength(2);
  });

  it("falls back to the shared key when the agent's own key is refused", async () => {
    const seller = agent(person());
    upsertBrain({ agent_key: seller.key, api_key_enc: encryptSecret("sk-own"), key_label: seller.ens_name, model: "0gm-1.0-35b-a3b", credit_neuron: "1000", spent_neuron: "0", earned_units: "0", credited_from_earnings_neuron: "0", last_request_id: null });
    const calls = stubRouter((_url, init) => ((init?.headers as Record<string, string>).authorization === "Bearer sk-own" ? new Response("no", { status: 401 }) : chat("ok")));
    expect((await think(seller, { purpose: "summarize", messages })).text).toBe("ok");
    expect(chatCalls(calls).map(auth)).toEqual(["Bearer sk-own", "Bearer sk-shared"]);
  });
});

describe("spinning up", () => {
  it("creates an agent key with the management key, seeds credit and leaves a birth receipt", async () => {
    process.env.ZG_MANAGEMENT_KEY = "mk-admin";
    const calls = stubRouter((url) => (url.endsWith("/api-keys") ? new Response(JSON.stringify({ key: "sk-agent" })) : chat("I fix bugs.", "chatcmpl-birth")));
    const seller = agent(person());
    const brain = await spinUpBrain(seller);
    process.env.ZG_MANAGEMENT_KEY = "";

    expect(brain).toMatchObject({ key_label: seller.ens_name, credit_neuron: "920", last_request_id: "chatcmpl-birth" });
    const keyCall = calls.find((c) => c.url.endsWith("/api-keys"))!;
    expect(auth(keyCall)).toBe("Bearer mk-admin");
    expect(JSON.parse(String(keyCall.init?.body))).toEqual({ name: seller.ens_name, trust_mode: "private" });
    expect(trustMode(chatCalls(calls)[0])).toBe("private");
    expect(auth(chatCalls(calls)[0])).toBe("Bearer sk-agent");
    expect(listReceipts(seller.key)[0].purpose).toBe("birth");
    expect(recentEvents().filter((e) => e.type === "agent.born" && e.data.agentEnsName === seller.ens_name).map((e) => e.data.step)).toEqual(["brain-key", "first-thought"]);
  });

  it("uses the shared key and says so when key creation fails", async () => {
    const calls = stubRouter(() => chat("I fix bugs."));
    const seller = agent(person());
    const brain = await spinUpBrain(seller);
    expect(brain?.api_key_enc).toBeNull();
    expect(auth(chatCalls(calls)[0])).toBe("Bearer sk-shared");
    expect(trustMode(chatCalls(calls)[0])).toBe("private");
    expect(recentEvents().find((e) => e.data.agentEnsName === seller.ens_name && e.data.step === "brain-key")?.data.message).toMatch(/shared key/);
  });

  it("refuses a key answer without an sk- secret", async () => {
    process.env.ZG_MANAGEMENT_KEY = "mk-admin";
    stubRouter(() => new Response(JSON.stringify({ id: "key_1" })));
    await expect(createAgentKey("a")).rejects.toThrow(/no sk- key/);
    process.env.ZG_MANAGEMENT_KEY = "";
  });
});

describe("self-funding", () => {
  const seed = (key: string, credit: string) =>
    upsertBrain({ agent_key: key, api_key_enc: null, key_label: null, model: "m", credit_neuron: credit, spent_neuron: "0", earned_units: "0", credited_from_earnings_neuron: "0", last_request_id: null });

  it("credits the brain at the configured rate", () => {
    const seller = agent(person());
    seed(seller.key, "1000");
    expect(neuronForEarnings(500_000n)).toBe(1_000_000n);
    creditEarnings(seller, 500_000n);
    expect(getBrain(seller.key)).toMatchObject({ credit_neuron: "1001000", earned_units: "500000", credited_from_earnings_neuron: "1000000" });
    expect(brainView(seller).earnedUsdc).toBe("0.500000");
  });

  it("marks an agent below the minimum as dormant", () => {
    const seller = agent(person());
    seed(seller.key, "99");
    expect(isDormant(seller)).toBe(true);
    expect(brainView(seller).status).toBe("dormant");
    seed(seller.key, "100");
    expect(isDormant(seller)).toBe(false);
  });

  it("answers 503 before any payment when an agent is dormant", () => {
    const seller = agent(person());
    seed(seller.key, "1");
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    agentGate({ params: { label: seller.label } } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].error).toBe("agent_dormant");
    expect(next).not.toHaveBeenCalled();
  });

  it("lets an awake agent through to the x402 middleware", () => {
    const seller = agent(person());
    seed(seller.key, "1000");
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    agentGate({ params: { label: seller.label } } as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("when the Router can't be reached", () => {
  it("says so instead of \"fetch failed\"", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      if (String(input).endsWith("/models")) return new Response(JSON.stringify(MODELS));
      throw new TypeError("fetch failed");
    });
    await expect(think(agent(person()), { purpose: "summarize", messages })).rejects.toThrow(/Can't reach the 0G Router at router\.test/);
  });
});

describe("image and video agents", () => {
  const media = (modelType: "image" | "video", model: string) => {
    const seller = agent(person(), { task_type: modelType === "image" ? "image-gen" : "video-gen" });
    upsertBrain({ agent_key: seller.key, api_key_enc: encryptSecret("sk-own"), key_label: seller.ens_name, model, model_type: modelType, credit_neuron: "1000", spent_neuron: "0", earned_units: "0", credited_from_earnings_neuron: "0", last_request_id: null } as never);
    return seller;
  };
  const answer = (body: object) => () => new Response(JSON.stringify({ id: "job-1", usage: { prompt_tokens: 1, completion_tokens: 0 }, ...body }));

  it("sends a video to /videos without the private header, because no video model has a TEE provider", async () => {
    const calls = stubRouter(answer({ status: "queued" }));
    const { text } = await think(media("video", "bytedance/seedance-2.0-mini"), { purpose: "video-gen", messages });
    const call = calls.find((c) => c.url.endsWith("/videos"))!;
    expect(trustMode(call)).toBeUndefined();
    expect(JSON.parse(String(call.init?.body))).toEqual({ model: "bytedance/seedance-2.0-mini", prompt: "hi" });
    expect(text).toMatch(/job-1/);
  });

  it("returns the image, and keeps a TEE-backed image model private", async () => {
    const calls = stubRouter(answer({ data: [{ url: "https://cdn.test/a.png" }] }));
    const { text } = await think(media("image", "cheap"), { purpose: "image-gen", messages });
    expect(text).toBe("https://cdn.test/a.png");
    expect(trustMode(calls.find((c) => c.url.endsWith("/images/generations"))!)).toBe("private");
  });

  it("leaves an image model without a TEE provider on standard providers", async () => {
    const calls = stubRouter(answer({ data: [{ b64_json: "AAAA" }] }));
    const { text } = await think(media("image", "open"), { purpose: "image-gen", messages });
    expect(text).toBe("data:image/png;base64,AAAA");
    expect(trustMode(calls.find((c) => c.url.endsWith("/images/generations"))!)).toBeUndefined();
  });

  it("keeps the raw answer when a provider shapes it differently, so the link isn't lost", async () => {
    stubRouter(answer({ data: { image_urls: ["https://cdn.test/a.png"] } }));
    const { text } = await think(media("image", "open"), { purpose: "image-gen", messages });
    expect(text).toContain("https://cdn.test/a.png");
  });

  it("gives media agents a standard key", async () => {
    process.env.ZG_MANAGEMENT_KEY = "mk-admin";
    const calls = stubRouter(() => new Response(JSON.stringify({ key: "sk-agent" })));
    await spinUpBrain(agent(person(), { task_type: "video-gen" }), { modelType: "video", model: "bytedance/seedance-2.0-mini" });
    process.env.ZG_MANAGEMENT_KEY = "";
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/api-keys"))!.init?.body)).trust_mode).toBe("standard");
  });
});
