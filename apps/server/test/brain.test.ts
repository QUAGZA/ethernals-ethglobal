import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Configure BEFORE the modules load: a temp database and a fake Router host.
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "brain-test-")), "t.db");
process.env.ZG_ENABLED = "true";
process.env.ZG_API_KEY = "sk-test";
process.env.ZG_ROUTER_BASE_URL = "http://zg.test/v1";
process.env.ZG_MODEL = "";

type Brain = typeof import("../src/brain");
type Proofs = typeof import("../src/proofs");
let brain: Brain;
let proofs: Proofs;
let db: typeof import("../src/db");

const MODELS = {
  data: [
    { id: "cheap-model", pricing: { prompt: "1", completion: "2" } },
    { id: "0gm-1.0-35b-a3b", pricing: { prompt: "10", completion: "20" } },
  ],
};

function mockRouter(chat: (init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/models")) return Response.json(MODELS);
    return chat(init!);
  });
  return calls;
}

beforeAll(async () => {
  brain = await import("../src/brain");
  proofs = await import("../src/proofs");
  db = await import("../src/db");
});
afterEach(() => vi.unstubAllGlobals());

describe("0G brain", () => {
  it("prefers 0gm-1.0-35b-a3b, calls the Router with the key, and records a receipt with the request id", async () => {
    const calls = mockRouter(() =>
      Response.json({
        id: "chatcmpl-1",
        choices: [{ message: { content: "<think>hmm</think>Hello there." } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
        x_0g_trace: { request_id: "req-123", provider: "0xprovider", billing: { total_cost: "999" } },
      }),
    );
    const t = await brain.think({ agent: "fixer.eth", purpose: "code-fix", system: "s", user: "u" });
    expect(t.text).toBe("Hello there.");
    expect(t.receipt).toMatchObject({ model: "0gm-1.0-35b-a3b", requestId: "req-123", provider: "0xprovider", costNeuron: "999", promptTokens: 5, completionTokens: 7 });
    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect((chat.init!.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(chat.init!.body as string).model).toBe("0gm-1.0-35b-a3b");
    expect(db.listInference(5)[0].request_id).toBe("req-123");
    expect(db.inferenceTotals().spentNeuron).toBe("999");
  });

  it("computes cost from model pricing when the Router sends no billing block", async () => {
    mockRouter(() => Response.json({ id: "c2", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
    const t = await brain.think({ agent: "a", purpose: "p", system: "s", user: "u" });
    expect(t.receipt.costNeuron).toBe(String(3 * 10 + 4 * 20));
    expect(t.receipt.requestId).toBe("c2");
  });

  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    mockRouter(() => (n++ === 0 ? new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow" } }), { status: 429, headers: { "retry-after": "0" } }) : Response.json({ id: "c3", choices: [{ message: { content: "fine" } }] })));
    expect((await brain.think({ agent: "a", purpose: "p", system: "s", user: "u" })).text).toBe("fine");
    expect(n).toBe(2);
  });

  it("explains an empty balance and an empty answer", async () => {
    mockRouter(() => new Response(JSON.stringify({ error: { code: "insufficient_balance", message: "no funds" } }), { status: 402 }));
    await expect(brain.think({ agent: "a", purpose: "p", system: "s", user: "u" })).rejects.toThrow(/insufficient_balance/);
    mockRouter(() => Response.json({ id: "c4", choices: [{ message: { content: "<think>only reasoning</think>" } }] }));
    await expect(brain.think({ agent: "a", purpose: "p", system: "s", user: "u" })).rejects.toThrow(/no answer text/);
  });
});

describe("live agent helpers", () => {
  it("extracts the python block from a model answer, or falls back to the raw answer", () => {
    expect(proofs.extractCode("Sure!\n```python\nprint(1)\n```\nDone")).toBe("print(1)\n");
    expect(proofs.extractCode("x = 1")).toBe("x = 1\n");
  });
});
