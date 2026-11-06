/**
 * The agents' brain: every model call goes to the 0G Compute Router (OpenAI-compatible) and leaves a receipt
 * (the Router's request id, provider, tokens and cost in neuron). Plain fetch, no extra dependency.
 *
 * Auth: one shared sk- key (ZG_API_KEY) with per-agent accounting on our side. Per-agent keys via a management
 * key are not wired up, because the key-creation request/response shape could not be verified from the docs.
 */
import type { BrainStatusView, InferenceReceipt } from "@ethernals/shared";
import { config } from "./config";
import { insertInference, inferenceTotals } from "./db";
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

async function routerFetch(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (init.auth !== false) headers.authorization = `Bearer ${config.zg.apiKey}`;
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
export async function resolveModel(): Promise<ModelInfo> {
  const models = await listModels();
  if (models.length === 0) throw new AppError(502, "The 0G Router lists no models.");
  if (config.zg.model) {
    const m = models.find((x) => x.id === config.zg.model);
    if (!m) throw new AppError(400, `ZG_MODEL "${config.zg.model}" is not offered by the Router.`, `Available: ${models.map((x) => x.id).join(", ")}`);
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
  if (!brainEnabled()) throw new AppError(503, "0G is not configured.", "Set ZG_ENABLED=true and ZG_API_KEY in .env (see docs/proof-of-work/0G-SETUP.md).");
  const model = await resolveModel();
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
    res = await routerFetch("/chat/completions", { method: "POST", body: request });
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
