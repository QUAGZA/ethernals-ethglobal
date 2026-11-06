/**
 * Agents think on the 0G Compute Router: an OpenAI-compatible API. Each agent gets its own API key, every call leaves a
 * receipt, and earnings credit the agent's "brain". Prompts and completions are never stored; only ids, counts and costs.
 * The Router balance is the platform's treasury, so brain credit is internal accounting of earned versus spent.
 */
import { formatUnits6, type AgentBrainView, type InferenceReceipt } from "@ethernals/shared";
import { config } from "./config";
import { decryptSecret, encryptSecret, randomId } from "./crypto";
import {
  countReceipts,
  getAgent,
  getBrain,
  insertReceipt,
  listReceipts,
  listReceiptsForTask,
  upsertBrain,
  type AgentRow,
  type BrainRow,
  type ReceiptRow,
} from "./db";
import { queueEarningsUpdate } from "./ens";
import { emit, log } from "./events";
import { llmMode } from "./llm-mode";
import { createSafeFetch } from "./sandbox";

const PREFERRED_MODEL = "0gm-1.0-35b-a3b";
const PRICING_TTL_MS = 10 * 60 * 1000;
/** Thinking models spend tokens on reasoning before they answer. */
const MIN_MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const PLATFORM_AGENT_KEY = "platform";

export interface RouterModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ThinkRequest {
  purpose: string;
  taskId?: string | null;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Ask for JSON and return the last JSON object in the answer. */
  json?: boolean;
}

export interface ThinkResult {
  text: string;
  json: unknown;
  receipt: InferenceReceipt;
}

export class RouterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RouterError";
  }
}

const safeFetch = () => createSafeFetch();

// ---------------------------------------------------------------- models and pricing

let modelCache: { models: RouterModel[]; at: number } | null = null;

export function clearModelCache(): void {
  modelCache = null;
}

export async function loadModels(): Promise<RouterModel[]> {
  if (modelCache && Date.now() - modelCache.at < PRICING_TTL_MS) return modelCache.models;
  try {
    const res = await safeFetch()(`${config.zeroG.routerBaseUrl()}/models`);
    if (!res.ok) throw new RouterError(res.status, `The 0G Router answered HTTP ${res.status} for /models.`);
    const body = (await res.json()) as { data?: RouterModel[] };
    modelCache = { models: body.data ?? [], at: Date.now() };
    return modelCache.models;
  } catch (err) {
    if (modelCache) return modelCache.models; // stale pricing beats no thinking
    throw err;
  }
}

const price = (value: string | undefined): bigint => {
  const whole = (value ?? "0").split(".")[0];
  return /^\d+$/.test(whole) ? BigInt(whole) : 0n;
};

const supportsJson = (m: RouterModel) => m.supported_parameters?.includes("response_format") ?? false;
const blendedPrice = (m: RouterModel) => price(m.pricing?.prompt) + price(m.pricing?.completion);

/** ZG_MODEL if set, else 0G's own coding model, else the cheapest model that can answer in JSON. */
export function chooseModel(models: RouterModel[], preferred = config.zeroG.model()): RouterModel {
  const find = (id: string) => models.find((m) => m.id === id);
  if (preferred) return find(preferred) ?? { id: preferred };
  const picked =
    find(PREFERRED_MODEL) ??
    models
      .filter((m) => supportsJson(m) && blendedPrice(m) > 0n)
      .sort((a, b) => (blendedPrice(a) < blendedPrice(b) ? -1 : blendedPrice(a) > blendedPrice(b) ? 1 : 0))[0];
  if (!picked) throw new RouterError(503, "The 0G Router lists no usable model.");
  return picked;
}

export async function resolveModel(): Promise<RouterModel> {
  return chooseModel(await loadModels());
}

export function costOf(model: RouterModel, promptTokens: number, completionTokens: number): bigint {
  return BigInt(promptTokens) * price(model.pricing?.prompt) + BigInt(completionTokens) * price(model.pricing?.completion);
}

// ---------------------------------------------------------------- answers

/** Reasoning models may think out loud before answering, so the answer is the LAST complete JSON object in the text. */
export function extractLastJson(text: string): unknown {
  let last: unknown = undefined;
  let found = false;
  for (let start = text.indexOf("{"); start !== -1; ) {
    const end = balancedEnd(text, start);
    if (end !== -1) {
      try {
        last = JSON.parse(text.slice(start, end + 1));
        found = true;
        start = text.indexOf("{", end + 1);
        continue;
      } catch {
        /* a brace in prose: try the next one */
      }
    }
    start = text.indexOf("{", start + 1);
  }
  if (!found) throw new Error("The model's answer has no JSON object.");
  return last;
}

function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

function providerFrom(res: Response, body: { provider?: unknown }): string | null {
  for (const name of ["x-0g-provider-address", "x-provider-address", "x-0g-provider"]) {
    const value = res.headers.get(name);
    if (value) return value;
  }
  return typeof body.provider === "string" ? body.provider : null;
}

// ---------------------------------------------------------------- the call

interface ChatResponse {
  id?: string;
  provider?: unknown;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const retryable = (status: number) => status === 429 || status >= 500;

let retryDelayMs = 1500;
export function setRetryDelayForTests(ms: number): void {
  retryDelayMs = ms;
}

async function postChat(apiKey: string, payload: unknown): Promise<Response> {
  const send = () =>
    safeFetch()(`${config.zeroG.routerBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  const first = await send();
  if (!retryable(first.status)) return first;
  await first.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  return send();
}

function agentApiKey(brain: BrainRow | undefined): string | null {
  if (brain?.api_key_enc) return decryptSecret(brain.api_key_enc);
  return config.zeroG.apiKeyOrNull();
}

async function callRouter(key: string, payload: unknown): Promise<{ res: Response; body: ChatResponse }> {
  const res = await postChat(key, payload);
  if (!res.ok) throw new RouterError(res.status, `The 0G Router answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { res, body: (await res.json()) as ChatResponse };
}

/**
 * One thought on 0G. `agent` null means the platform itself (the buyer-side judge), on the shared key.
 * Every call records a receipt and spends the agent's credit.
 */
export async function think(agent: AgentRow | null, request: ThinkRequest): Promise<ThinkResult> {
  const brain = agent ? ensureBrain(agent, await resolveModel()) : undefined;
  const model = await resolveModel();
  const modelId = brain?.model ?? model.id;
  const usable = modelId === model.id ? model : ((await loadModels()).find((m) => m.id === modelId) ?? model);

  const payload: Record<string, unknown> = {
    model: usable.id,
    messages: request.messages,
    max_tokens: Math.max(request.maxTokens ?? 0, MIN_MAX_TOKENS),
  };
  if (usable.supported_parameters?.includes("reasoning_effort")) payload.reasoning_effort = "low";
  if (request.json && supportsJson(usable)) payload.response_format = { type: "json_object" };

  const ownKey = agent ? agentApiKey(brain) : config.zeroG.apiKeyOrNull();
  if (!ownKey) throw new RouterError(503, "No 0G API key is set. Add ZG_API_KEY to .env (see SETUP.md).");
  const shared = config.zeroG.apiKeyOrNull();

  let answer: { res: Response; body: ChatResponse };
  try {
    answer = await callRouter(ownKey, payload);
  } catch (err) {
    const keyRefused = err instanceof RouterError && (err.status === 401 || err.status === 403);
    if (!keyRefused || !shared || shared === ownKey) throw err;
    emit("info", { agentEnsName: agent?.ens_name, message: "This agent's 0G key was refused, so it used the shared key." });
    answer = await callRouter(shared, payload);
  }

  const { res, body } = answer;
  const text = body.choices?.[0]?.message?.content ?? "";
  const promptTokens = body.usage?.prompt_tokens ?? 0;
  const completionTokens = body.usage?.completion_tokens ?? 0;
  const requestId = body.id ?? res.headers.get("x-request-id") ?? randomId("zg");
  const receipt = recordReceipt({
    agent,
    purpose: request.purpose,
    taskId: request.taskId ?? null,
    model: usable,
    requestId,
    provider: providerFrom(res, body),
    promptTokens,
    completionTokens,
  });

  if (!text.trim()) throw new RouterError(502, "The model spent its whole token budget thinking and gave no answer.");
  const clean = stripThinking(text);
  return { text: clean, json: request.json ? extractLastJson(clean) : undefined, receipt };
}

function recordReceipt(r: {
  agent: AgentRow | null;
  purpose: string;
  taskId: string | null;
  model: RouterModel;
  requestId: string;
  provider: string | null;
  promptTokens: number;
  completionTokens: number;
}): InferenceReceipt {
  const cost = costOf(r.model, r.promptTokens, r.completionTokens);
  const row = insertReceipt({
    id: randomId("rcpt"),
    agent_key: r.agent?.key ?? PLATFORM_AGENT_KEY,
    task_id: r.taskId,
    purpose: r.purpose,
    model: r.model.id,
    request_id: r.requestId,
    provider: r.provider,
    prompt_tokens: r.promptTokens,
    completion_tokens: r.completionTokens,
    cost_neuron: cost.toString(),
  });
  if (r.agent) {
    const brain = getBrain(r.agent.key)!;
    const credit = BigInt(brain.credit_neuron);
    upsertBrain({
      ...brain,
      credit_neuron: (credit > cost ? credit - cost : 0n).toString(),
      spent_neuron: (BigInt(brain.spent_neuron) + cost).toString(),
      last_request_id: r.requestId,
    });
  }
  const receipt = receiptView(row);
  emit("inference.receipt", {
    agentEnsName: receipt.agentEnsName,
    requestId: receipt.requestId,
    taskId: receipt.taskId,
    purpose: receipt.purpose,
    message: `${receipt.agentEnsName} thought on 0G (${receipt.purpose}): ${receipt.requestId}`,
  });
  return receipt;
}

// ---------------------------------------------------------------- spin-up

/** An agent without a brain (made before 0G was on) starts on the shared key with the seed credit. */
function ensureBrain(agent: AgentRow, model: RouterModel): BrainRow {
  return (
    getBrain(agent.key) ??
    upsertBrain({
      agent_key: agent.key,
      api_key_enc: null,
      key_label: null,
      model: model.id,
      credit_neuron: config.zeroG.seedCreditNeuron().toString(),
      spent_neuron: "0",
      earned_units: "0",
      credited_from_earnings_neuron: "0",
      last_request_id: null,
    })
  );
}

/** POST /v1/api-keys with the management key. The Router's docs do not fix the field name of the secret, so accept the likely ones. */
export async function createAgentKey(label: string): Promise<string> {
  const management = config.zeroG.managementKey();
  if (!management) throw new RouterError(503, "ZG_MANAGEMENT_KEY is not set.");
  const res = await safeFetch()(`${config.zeroG.routerBaseUrl()}/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${management}` },
    body: JSON.stringify({ label, name: label }),
  });
  if (!res.ok) throw new RouterError(res.status, `Key creation answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
  for (const source of [body, body.data ?? {}]) {
    for (const field of ["key", "api_key", "apiKey", "secret", "token"]) {
      const value = source[field];
      if (typeof value === "string" && value.startsWith("sk-")) return value;
    }
  }
  throw new RouterError(502, "Key creation worked, but the answer held no sk- key.");
}

function born(agent: AgentRow, step: string, message: string): void {
  emit("agent.born", { agentEnsName: agent.ens_name, step, message });
}

/** Gives a new seller agent its own 0G key, its seed credit and a first thought. Keeps going on failure and says so. */
export async function spinUpBrain(agent: AgentRow): Promise<BrainRow | null> {
  if (!config.zeroG.enabled()) return null;
  let model: RouterModel;
  try {
    model = await resolveModel();
  } catch (err) {
    log.error(`0G Router unreachable while spinning up ${agent.ens_name}`, err);
    born(agent, "brain", `0G brain ✖ the Router is unreachable: ${(err as Error).message}`);
    model = { id: config.zeroG.model() ?? PREFERRED_MODEL };
  }

  let encrypted: string | null = null;
  let keyLabel: string | null = null;
  try {
    encrypted = encryptSecret(await createAgentKey(agent.ens_name));
    keyLabel = agent.ens_name;
    born(agent, "brain-key", "0G brain key ✓");
  } catch (err) {
    log.warn(`per-agent 0G key failed for ${agent.ens_name}`, { error: (err as Error).message });
    born(agent, "brain-key", `0G brain key: using the shared key (${(err as Error).message})`);
  }

  upsertBrain({
    agent_key: agent.key,
    api_key_enc: encrypted,
    key_label: keyLabel,
    model: model.id,
    credit_neuron: config.zeroG.seedCreditNeuron().toString(),
    spent_neuron: "0",
    earned_units: "0",
    credited_from_earnings_neuron: "0",
    last_request_id: null,
  });

  try {
    const { receipt } = await think(agent, {
      purpose: "birth",
      messages: [
        { role: "system", content: "You are an AI agent that was just created. Answer in one short sentence." },
        { role: "user", content: `Your name is ${agent.ens_name}. Say what you are and what you do: ${agent.description}` },
      ],
    });
    born(agent, "first-thought", `first thought ✓ request id ${receipt.requestId}`);
  } catch (err) {
    log.error(`first thought failed for ${agent.ens_name}`, err);
    born(agent, "first-thought", `first thought ✖ ${(err as Error).message}`);
  }
  return getBrain(agent.key) ?? null;
}

// ---------------------------------------------------------------- self-funding

/** The neuron credit that `units` of earned USDC buy. */
export function neuronForEarnings(units: bigint): bigint {
  return (units * config.zeroG.neuronPerUsdc()) / 1_000_000n;
}

/** Credits an agent's brain with money it earned. */
export function creditEarnings(agent: AgentRow, units: bigint): BrainRow | null {
  if (!config.zeroG.enabled() || units <= 0n) return null;
  const brain = getBrain(agent.key);
  if (!brain) return null;
  const gained = neuronForEarnings(units);
  return upsertBrain({
    ...brain,
    credit_neuron: (BigInt(brain.credit_neuron) + gained).toString(),
    earned_units: (BigInt(brain.earned_units) + units).toString(),
    credited_from_earnings_neuron: (BigInt(brain.credited_from_earnings_neuron) + gained).toString(),
  });
}

/** Credits a verified attempt fee and schedules the ENS update. */
export function creditAttemptFee(agent: AgentRow, units: bigint): void {
  if (creditEarnings(agent, units)) queueEarningsUpdate(agent);
}

/** A buyer must never pay an agent that cannot think. */
export function isDormant(agent: AgentRow): boolean {
  if (!config.zeroG.enabled()) return false;
  const brain = getBrain(agent.key);
  return brain ? BigInt(brain.credit_neuron) < config.zeroG.minCreditNeuron() : false;
}

// ---------------------------------------------------------------- views

function receiptView(row: ReceiptRow): InferenceReceipt {
  return {
    agentEnsName: getAgent(row.agent_key)?.ens_name ?? row.agent_key,
    purpose: row.purpose,
    taskId: row.task_id,
    model: row.model,
    requestId: row.request_id,
    provider: row.provider,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costNeuron: row.cost_neuron,
    at: row.created_at,
  };
}

export const agentReceipts = (agent: AgentRow): InferenceReceipt[] => listReceipts(agent.key, 50).map(receiptView);
export const taskReceipts = (taskId: string): InferenceReceipt[] => listReceiptsForTask(taskId).map(receiptView);

export function brainView(agent: AgentRow): AgentBrainView {
  const brain = getBrain(agent.key);
  const backend = config.zeroG.enabled() ? "0g-router" : llmMode();
  return {
    backend,
    network: config.zeroG.enabled() ? config.zeroG.network() : null,
    model: brain?.model ?? (config.zeroG.enabled() ? (config.zeroG.model() ?? PREFERRED_MODEL) : config.llm.model),
    keyLabel: brain?.key_label ?? null,
    creditNeuron: brain?.credit_neuron ?? "0",
    spentNeuron: brain?.spent_neuron ?? "0",
    earnedUsdc: formatUnits6(BigInt(brain?.earned_units ?? "0")),
    creditedFromEarningsNeuron: brain?.credited_from_earnings_neuron ?? "0",
    status: isDormant(agent) ? "dormant" : "awake",
    receipts: countReceipts(agent.key),
    lastRequestId: brain?.last_request_id ?? null,
  };
}
