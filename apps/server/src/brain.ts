/**
 * The agents' brain: every model call goes to the 0G Compute Router (OpenAI-compatible) and leaves a receipt
 * (the Router's request id, provider, tokens and cost in neuron). Plain fetch, no extra dependency.
 *
 * Auth: one shared sk- key (ZG_API_KEY) with per-agent accounting on our side. Per-agent keys via a management
 * key are not wired up, because the key-creation request/response shape could not be verified from the docs.
 */
import type { BrainStatusView, InferenceReceipt } from "@ethernals/shared";
import { config } from "./config";
import { insertInference, inferenceTotals, kvGet, kvSet } from "./db";
import { AppError } from "./errors";
import { log } from "./events";

export function brainEnabled(): boolean {
  return config.zg.enabled && config.zg.apiKey !== "";
}

interface ModelInfo {
  id: string;
  pricing: { prompt: bigint; completion: bigint };
}

let modelCache: { at: number; models: ModelInfo[] } | null = null;
const PREFERRED = ["0gm-1.0-35b-a3b", "glm-5.2"];

/** All configured sk- keys: ZG_API_KEY first, then ZG_API_KEYS. */
export function keyPool(): string[] {
  return [...new Set([config.zg.apiKey, ...config.zg.extraKeys].filter(Boolean))];
}

/**
 * Which key an agent thinks with. The platform and checks use the first key. Each named agent is assigned the next
 * key in turn the first time it thinks, and keeps it (stored), so two agents can spend from two separate accounts.
 */
export function keyFor(agent: string): string {
  const pool = keyPool();
  if (pool.length <= 1 || agent === "platform" || agent === "zg-check") return pool[0] ?? "";
  const slot = `zgkey:${agent}`;
  let idx = kvGet<number>(slot);
  if (idx === null || idx >= pool.length) {
    const next = kvGet<number>("zgkey:next") ?? 0;
    idx = next % pool.length;
    kvSet(slot, idx);
    kvSet("zgkey:next", next + 1);
  }
  return pool[idx];
}

async function routerFetch(path: string, init: RequestInit & { auth?: boolean; key?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (init.auth !== false) headers.authorization = `Bearer ${init.key ?? config.zg.apiKey}`;
  try {
    return await fetch(`${config.zg.baseUrl}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(10 * 60 * 1000) });
  } catch (err) {
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    throw new AppError(
      503,
      `Could not reach the 0G Router (${config.zg.baseUrl}).`,
      `${cause?.code ?? cause?.message ?? (err as Error).message}. If this is a TLS handshake error, try ZG_NETWORK=mainnet with ZG_ROUTER_BASE_URL=https://router-api.0g.ai/v1 (needs a real 0G deposit).`,
    );
  }
}

export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models;
  const res = await routerFetch("/models", { auth: false, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new AppError(502, `0G Router /models answered HTTP ${res.status}.`);
  const body = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
  const models = (body.data ?? []).map((m) => ({
    id: m.id,
    pricing: { prompt: BigInt(m.pricing?.prompt ?? "0"), completion: BigInt(m.pricing?.completion ?? "0") },
  }));
  modelCache = { at: Date.now(), models };
  return models;
}

/** ZG_MODEL if set; else a preferred model if the Router lists it; else the cheapest listed model. */
export async function resolveModel(requested?: string): Promise<ModelInfo> {
  const models = await listModels();
  if (models.length === 0) throw new AppError(502, "The 0G Router lists no models.");
  const wanted = requested || config.zg.model;
  if (wanted) {
    const m = models.find((x) => x.id === wanted);
    if (!m) throw new AppError(400, `Model "${wanted}" is not offered by the Router.`, `Available: ${models.map((x) => x.id).join(", ")}`);
    return m;
  }
  for (const id of PREFERRED) {
    const m = models.find((x) => x.id === id);
    if (m) return m;
  }
  return [...models].sort((a, b) => Number(a.pricing.prompt + a.pricing.completion - (b.pricing.prompt + b.pricing.completion)))[0];
}

export interface ThinkOptions {
  agent: string;
  purpose: string;
  taskId?: string | null;
  system: string;
  user: string;
  maxTokens?: number;
  /** A specific key (a hoster's own 0G key). Default: the key assigned to this agent from the server pool. */
  apiKey?: string;
  /** A specific model id. Default: the server's choice (ZG_MODEL or a preferred model). */
  model?: string;
}

export interface Thought {
  text: string;
  receipt: InferenceReceipt;
  receiptId: number;
}

interface ChatBody {
  id?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  x_0g_trace?: { request_id?: string; provider?: string; billing?: { total_cost?: string } };
  error?: { message?: string; code?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One model call on 0G. Retries rate limits and provider failures; records a receipt for every successful call. */
export async function think(opts: ThinkOptions): Promise<Thought> {
  const apiKey = opts.apiKey ?? (brainEnabled() ? keyFor(opts.agent) : "");
  if (!apiKey) throw new AppError(503, "0G is not configured.", "Set ZG_ENABLED=true and ZG_API_KEY in .env, or give the agent its own key (see docs/proof-of-work/0G-SETUP.md).");
  const model = await resolveModel(opts.model);
  const request = JSON.stringify({
    model: model.id,
    // Thinking models spend many tokens on reasoning before the answer, so leave room.
    max_tokens: opts.maxTokens ?? 4000,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await routerFetch("/chat/completions", { method: "POST", body: request, key: apiKey });
    if (res.status !== 429 && res.status !== 502 && res.status !== 503) break;
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
    log.warn(`0G Router HTTP ${res.status}, retrying in ${wait}s`);
    await sleep(Math.min(wait, 30) * 1000);
  }
  const body = (await res!.json().catch(() => ({}))) as ChatBody;
  if (!res!.ok) {
    const code = body.error?.code ?? String(res!.status);
    const hint =
      res!.status === 401 ? "Check ZG_API_KEY (an sk- key for this network)." :
      res!.status === 402 ? "The Router balance is empty. Deposit 0G at the dashboard." : undefined;
    throw new AppError(502, `0G Router error (${code}): ${body.error?.message ?? "request failed"}`, hint);
  }

  const raw = body.choices?.[0]?.message?.content ?? "";
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new AppError(502, "The 0G model returned no answer text.", "It may have spent all tokens on reasoning; raise max_tokens or pick another ZG_MODEL.");

  const promptTokens = body.usage?.prompt_tokens ?? 0;
  const completionTokens = body.usage?.completion_tokens ?? 0;
  const cost =
    body.x_0g_trace?.billing?.total_cost ??
    (BigInt(promptTokens) * model.pricing.prompt + BigInt(completionTokens) * model.pricing.completion).toString();
  const receipt: InferenceReceipt = {
    agentEnsName: opts.agent,
    purpose: opts.purpose,
    taskId: opts.taskId ?? null,
    model: model.id,
    requestId: body.x_0g_trace?.request_id ?? res!.headers.get("x-request-id") ?? body.id ?? "unknown",
    provider: body.x_0g_trace?.provider ?? null,
    promptTokens,
    completionTokens,
    costNeuron: cost,
    at: new Date().toISOString(),
  };
  const receiptId = insertInference({
    agent: receipt.agentEnsName,
    purpose: receipt.purpose,
    task_id: receipt.taskId,
    model: receipt.model,
    request_id: receipt.requestId,
    provider: receipt.provider,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cost_neuron: cost,
    at: receipt.at,
  });
  return { text, receipt, receiptId };
}

export async function brainStatus(): Promise<BrainStatusView> {
  const totals = inferenceTotals();
  const base: BrainStatusView = {
    enabled: brainEnabled(),
    network: config.zg.network,
    baseUrl: config.zg.baseUrl,
    keyConfigured: config.zg.apiKey !== "",
    keys: keyPool().length,
    managementKeyConfigured: config.zg.managementKey !== "",
    model: null,
    reachable: false,
    error: null,
    calls: totals.calls,
    spentNeuron: totals.spentNeuron,
  };
  try {
    base.model = (await resolveModel()).id;
    base.reachable = true;
  } catch (e) {
    base.error = (e as Error).message;
  }
  return base;
}

/**
 * Checks a hoster's own 0G key and model with one tiny call (a few hundred tokens at most). Run before an agent is
 * created, so a wrong key fails with a clear message instead of failing on the first customer's task.
 */
export async function testBrainKey(apiKey: string, model?: string): Promise<{ model: string; requestId: string | null; models: string[] }> {
  const models = (await listModels()).map((m) => m.id);
  const chosen = await resolveModel(model || undefined);
  const t = await think({ agent: "key-check", purpose: "check", system: "Reply with the single word: ok", user: "ping", maxTokens: 2000, apiKey, model: chosen.id });
  return { model: chosen.id, requestId: t.receipt.requestId, models };
}
