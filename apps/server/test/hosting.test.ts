import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hosting-test-")), "t.db");
process.env.KEYSTORE_SECRET = "test-keystore-secret-0123456789abcdef";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef";
process.env.PERSON_HASH_SECRET = "test-person-secret-0123456789abcdef";
process.env.ZG_ENABLED = "false"; // hoster keys must work even with no platform key
process.env.ZG_API_KEY = "";
process.env.ZG_ROUTER_BASE_URL = "http://zg.test/v1";

type Tools = typeof import("../src/tools");
type Custom = typeof import("../src/custom-agent");
let tools: Tools;
let custom: Custom;
let crypto: typeof import("../src/crypto");
let db: typeof import("../src/db");

beforeAll(async () => {
  tools = await import("../src/tools");
  custom = await import("../src/custom-agent");
  crypto = await import("../src/crypto");
  db = await import("../src/db");
}, 60_000);
afterEach(() => vi.unstubAllGlobals());

describe("calculator", () => {
  it("evaluates with precedence, parentheses, unary minus and powers", () => {
    expect(tools.evaluate("2+3*4")).toBe(14);
    expect(tools.evaluate("(2+3)*4")).toBe(20);
    expect(tools.evaluate("-2^2")).toBe(-4);
    expect(tools.evaluate("2^3^2")).toBe(512);
    expect(tools.evaluate("10 % 4 + 7 / 2")).toBe(5.5);
  });
  it("rejects code, division by zero and junk (no eval)", () => {
    for (const bad of ["process.exit()", "1/0", "2+", "(1+2", "1;2", "", "1+".repeat(200)]) expect(() => tools.evaluate(bad)).toThrow();
  });
});

describe("fetch_url safety", () => {
  it("treats loopback, private, link-local and mapped addresses as non-public", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(tools.isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(tools.isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses http, credentials, odd ports and literal private hosts before any connection", async () => {
    await expect(tools.fetchUrl("http://example.com")).rejects.toThrow(/https/);
    await expect(tools.fetchUrl("https://user:pw@example.com")).rejects.toThrow(/credentials/);
    await expect(tools.fetchUrl("https://example.com:8443")).rejects.toThrow(/port/);
    await expect(tools.fetchUrl("https://127.0.0.1/x")).rejects.toThrow(/non-public/);
    await expect(tools.fetchUrl("https://[::1]/x")).rejects.toThrow(/non-public/);
    await expect(tools.fetchUrl("not a url")).rejects.toThrow(/valid URL/);
  });
});

describe("custom agent loop", () => {
  function brainRow(tools: string[]) {
    return {
      agent_key: "0xabc",
      provider: "0g" as const,
      enc_api_key: crypto.encryptSecret("sk-hoster-secret"),
      model: "0gm-1.0-35b-a3b",
      system_prompt: "You are a pricing analyst who answers with exact arithmetic.",
      tools_json: JSON.stringify(tools),
      created_at: "",
    };
  }
  const agent = { ens_name: "analyst.quaz.eth", key: "0xabc" } as import("../src/db").AgentRow;

  function mockRouter(replies: string[]) {
    const seen: { auth: string; body: { model: string; messages: { content: string }[] } }[] = [];
    let i = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "0gm-1.0-35b-a3b", pricing: { prompt: "1", completion: "1" } }] });
      seen.push({ auth: (init!.headers as Record<string, string>).authorization, body: JSON.parse(init!.body as string) });
      return Response.json({ id: `c${i}`, choices: [{ message: { content: replies[i++] ?? '{"final":"out of replies"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
    return seen;
  }

  it("uses the hoster key (not a platform key), runs a tool, feeds the result back, and returns the final answer", async () => {
    const seen = mockRouter(['Let me compute. {"tool":"calculator","args":{"expression":"12*(3+4)"}}', '{"final":"The total is 84."}']);
    const run = await custom.runCustomAgent({ agent, brain: brainRow(["calculator"]), task: "What is 12 times 7?", taskId: "t1" });
    expect(run.result).toBe("The total is 84.");
    expect(run.toolCalls).toEqual([{ tool: "calculator", ok: true }]);
    expect(seen.every((s) => s.auth === "Bearer sk-hoster-secret")).toBe(true);
    expect(seen[1].body.messages[1].content).toContain("<tool_result");
    expect(seen[1].body.messages[1].content).toContain("84");
    expect(db.listInference(5)[0].agent).toBe("analyst.quaz.eth");
  });

  it("refuses tools the hoster did not enable and tells the model", async () => {
    const seen = mockRouter(['{"tool":"fetch_url","args":{"url":"https://example.com"}}', '{"final":"done without it"}']);
    const run = await custom.runCustomAgent({ agent, brain: brainRow(["calculator"]), task: "x", taskId: "t2" });
    expect(run.toolCalls).toEqual([{ tool: "fetch_url", ok: false }]);
    expect(seen[1].body.messages[1].content).toContain("do not have a tool named");
    expect(run.result).toBe("done without it");
  });

  it("blocks hire_agent when the customer did not allow sub-hires", async () => {
    mockRouter(['{"tool":"hire_agent","args":{"agent":"translate","task":"hi"}}', '{"final":"ok"}']);
    const run = await custom.runCustomAgent({ agent, brain: brainRow(["hire_agent"]), task: "x", taskId: "t3" });
    expect(run.toolCalls).toEqual([{ tool: "hire_agent", ok: false }]);
  });

  it("passes a hire through when allowed, and a plain-text reply is the answer", async () => {
    mockRouter(['{"tool":"hire_agent","args":{"agent":"translate","task":"hello"}}', "Plain answer, not JSON."]);
    const hire = vi.fn(async (label: string, task: string) => `hired ${label}: ${task}`);
    const run = await custom.runCustomAgent({ agent, brain: brainRow(["hire_agent"]), task: "x", taskId: "t4", hire });
    expect(hire).toHaveBeenCalledWith("translate", "hello");
    expect(run.result).toBe("Plain answer, not JSON.");
  });

  it("stops after the step limit instead of looping forever", async () => {
    mockRouter(Array(10).fill('{"tool":"current_time","args":{}}'));
    const run = await custom.runCustomAgent({ agent, brain: brainRow(["current_time"]), task: "x", taskId: "t5" });
    expect(run.steps).toBe(custom.MAX_STEPS);
    expect(run.result).toMatch(/step limit/);
  });

  it("with no tools it answers in one call", async () => {
    const seen = mockRouter(["Direct answer."]);
    const run = await custom.runCustomAgent({ agent, brain: brainRow([]), task: "x", taskId: "t6" });
    expect(run.result).toBe("Direct answer.");
    expect(seen).toHaveLength(1);
  });
});

describe("json extraction and key storage", () => {
  it("finds the first JSON object inside prose and code fences", () => {
    expect(custom.extractJsonObject('Sure:\n```json\n{"final":"a {b} c"}\n```')).toEqual({ final: "a {b} c" });
    expect(custom.extractJsonObject("no json here")).toBeNull();
  });
  it("stores the hoster key encrypted and never as plain text", () => {
    const blob = crypto.encryptSecret("sk-secret-value");
    expect(blob).not.toContain("sk-secret-value");
    expect(crypto.decryptSecret(blob)).toBe("sk-secret-value");
  });
});
