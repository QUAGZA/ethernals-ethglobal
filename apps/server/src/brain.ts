/**
 * Agents think on the 0G Compute Router: an OpenAI-compatible API. Each agent gets its own API key, every call leaves a
 * receipt, and earnings credit the agent's "brain". Prompts and completions are never stored; only ids, counts and costs.
 * The Router balance is the platform's treasury, so brain credit is internal accounting of earned versus spent.
 * Prompts can hold repo code and hidden tests, so every call is pinned to 0G's sealed providers. 0G answers 503 when none
 * is available and never falls back to a weaker tier.
 */
import { formatUnits6, type AgentBrainView, type AgentConfigView, type InferenceReceipt } from "@ethernals/shared";
import { config } from "./config";
import { decryptSecret, encryptSecret, randomId } from "./crypto";
import {
  countReceipts,
  getAgent,
  getBrain,
  insertReceipt,
  listAgentTools,
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
import { loadToolBundle } from "./agent-tools";

const PREFERRED_MODEL = "0gm-1.0-35b-a3b";
const PRICING_TTL_MS = 10 * 60 * 1000;
/** Thinking models spend tokens on reasoning before they answer. */
const MIN_MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MODELS_TIMEOUT_MS = 10_000;
const PLATFORM_AGENT_KEY = "platform";
const TRUST_MODE = "private";
const TRUST_MODE_HEADER = "X-0G-Provider-Trust-Mode";

export interface RouterModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  verifiability?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The 0G Router model families and their endpoints. */
export const MODEL_TYPES = ["text", "image", "decision", "embedding", "video"] as const;
export type ModelType = (typeof MODEL_TYPES)[number];
const ENDPOINTS: Record<ModelType, string> = {
  text: "/chat/completions",
  image: "/images/generations",
  decision: "/decisions",
  embedding: "/embeddings",
  video: "/videos",
};
const MAX_TOOL_ROUNDS = 4;

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
    const res = await safeFetch()(`${config.zeroG.routerBaseUrl()}/models`, { signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) });
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

/** A model with a provider that runs inside a TEE, so private mode can serve it. */
export const isSealed = (m: RouterModel) => m.verifiability === "TeeML";

/** ZG_MODEL if set (a model with no sealed provider then answers 503), else 0G's own coding model, else the cheapest sealed JSON model. */
export function chooseModel(models: RouterModel[], preferred = config.zeroG.model()): RouterModel {
  const find = (id: string) => models.find((m) => m.id === id);
  if (preferred) return find(preferred) ?? { id: preferred };
  const own = find(PREFERRED_MODEL);
  const picked =
    own && isSealed(own)
      ? own
      : models
          .filter((m) => isSealed(m) && supportsJson(m) && blendedPrice(m) > 0n)
          .sort((a, b) => (blendedPrice(a) < blendedPrice(b) ? -1 : blendedPrice(a) > blendedPrice(b) ? 1 : 0))[0];
  if (!picked) throw new RouterError(503, "The 0G Router lists no sealed model that can answer in JSON.");
  return picked;
}

export async function resolveModel(): Promise<RouterModel> {
  return chooseModel(await loadModels());
}

/** The model name without waiting on the Router, so a slow Router never holds up the web app. Refreshes in the background. */
export function currentModelId(): string {
  void loadModels().catch(() => undefined);
  const configured = config.zeroG.model();
  if (configured || !modelCache) return configured ?? PREFERRED_MODEL;
  try {
    return chooseModel(modelCache.models).id;
  } catch {
    return PREFERRED_MODEL;
  }
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

interface ToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface ChatResponse {
  id?: string;
  provider?: unknown;
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const retryable = (status: number) => status === 429 || status >= 500;

let retryDelayMs = 1500;
export function setRetryDelayForTests(ms: number): void {
  retryDelayMs = ms;
}

/** `sealed` pins the call to TEE providers, and 0G then answers 503 rather than falling back. */
async function postChat(apiKey: string, payload: unknown, path = "/chat/completions", sealed = true): Promise<Response> {
  const send = () =>
    safeFetch()(`${config.zeroG.routerBaseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...(sealed ? { [TRUST_MODE_HEADER]: TRUST_MODE } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err: Error) => {
      if (err.name !== "TypeError") throw err; // keeps blocked hosts and timeouts as they are
      throw new RouterError(503, `Can't reach the 0G Router at ${new URL(config.zeroG.routerBaseUrl()).host}. Check ZG_ROUTER_BASE_URL in .env.`);
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

async function callRouter(key: string, payload: unknown, path = "/chat/completions", sealed = true): Promise<{ res: Response; body: ChatResponse }> {
  const res = await postChat(key, payload, path, sealed);
  if (!res.ok) throw new RouterError(res.status, `The 0G Router answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { res, body: (await res.json()) as ChatResponse };
}

/**
 * One thought on 0G. `agent` null means the platform itself (the buyer-side judge), on the shared key.
 * Every call records a receipt and spends the agent's credit.
 */
export async function think(agent: AgentRow | null, request: ThinkRequest): Promise<ThinkResult> {
  const stored = agent ? getBrain(agent.key) : undefined;
  const brain = agent ? (stored ?? ensureBrain(agent, await resolveModel())) : undefined;
  const modelType = (brain?.model_type as ModelType | undefined) ?? "text";
  const usable = await usableModel(brain);

  const ownKey = agent ? agentApiKey(brain) : config.zeroG.apiKeyOrNull();
  if (!ownKey) throw new RouterError(503, "No 0G API key is set. Add ZG_API_KEY to .env (see SETUP.md).");
  const shared = config.zeroG.apiKeyOrNull();
  // No video model and few image models have a TEE provider, so those run on standard providers. Text always stays sealed.
  const sealed = modelType === "text" || isSealed(usable);

  const send = async (payload: unknown, path: string) => {
    try {
      return await callRouter(ownKey, payload, path, sealed);
    } catch (err) {
      const keyRefused = err instanceof RouterError && (err.status === 401 || err.status === 403);
      if (!keyRefused || !shared || shared === ownKey) throw err;
      emit("info", { agentEnsName: agent?.ens_name, message: "This agent's 0G key was refused, so it used the shared key." });
      return callRouter(shared, payload, path, sealed);
    }
  };

  // The provider's own system prompt goes first, then the task's instructions.
  const messages: Record<string, unknown>[] = request.messages.map((m) => ({ ...m }));
  if (brain?.system_prompt) {
    const first = messages[0];
    if (first && first.role === "system") first.content = `${brain.system_prompt}\n\n${String(first.content)}`;
    else messages.unshift({ role: "system", content: brain.system_prompt });
  }

  let promptTokens = 0;
  let completionTokens = 0;
  let last: { res: Response; body: ChatResponse };
  let text = "";

  if (modelType !== "text") {
    last = await send(mediaPayload(modelType, usable.id, messages), ENDPOINTS[modelType]);
    text = mediaText(modelType, last.body);
    promptTokens = last.body.usage?.prompt_tokens ?? 0;
    completionTokens = last.body.usage?.completion_tokens ?? 0;
  } else {
    const payload: Record<string, unknown> = { model: usable.id, messages, max_tokens: Math.max(request.maxTokens ?? 0, MIN_MAX_TOKENS) };
    if (usable.supported_parameters?.includes("reasoning_effort")) payload.reasoning_effort = "low";
    if (request.json && supportsJson(usable)) payload.response_format = { type: "json_object" };
    const tools = agent && !request.json ? await loadToolBundle(agent.key) : null;
    if (tools) payload.tools = tools.defs;

    for (let round = 0; ; round++) {
      last = await send(payload, ENDPOINTS.text);
      promptTokens += last.body.usage?.prompt_tokens ?? 0;
      completionTokens += last.body.usage?.completion_tokens ?? 0;
      const message = last.body.choices?.[0]?.message;
      const calls = message?.tool_calls ?? [];
      if (!tools || calls.length === 0 || round >= MAX_TOOL_ROUNDS) {
        text = message?.content ?? "";
        break;
      }
      messages.push({ role: "assistant", content: message?.content ?? "", tool_calls: calls });
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* the tool sees empty arguments */
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: await tools.call(call.function.name, args) });
      }
    }
  }

  const { res, body } = last;
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

/** The agent's chosen model. Non-text models are not in the chat model list, so they skip it. A slow Router never blocks a text agent that already has a model. */
async function usableModel(brain: BrainRow | undefined): Promise<RouterModel> {
  if (brain?.model) {
    try {
      return (await loadModels()).find((m) => m.id === brain.model) ?? { id: brain.model };
    } catch {
      return { id: brain.model };
    }
  }
  return resolveModel();
}

function lastUserText(messages: Record<string, unknown>[]): string {
  const user = [...messages].reverse().find((m) => m.role === "user");
  return String(user?.content ?? "");
}

function mediaPayload(type: ModelType, model: string, messages: Record<string, unknown>[]): Record<string, unknown> {
  const prompt = lastUserText(messages);
  const system = messages.find((m) => m.role === "system")?.content;
  const full = system ? `${String(system)}\n\n${prompt}` : prompt;
  switch (type) {
    case "image":
    case "video":
      return { model, prompt: full };
    case "embedding":
      return { model, input: prompt };
    default:
      return { model, messages }; // decision
  }
}

function mediaText(type: ModelType, body: unknown): string {
  const b = body as Record<string, any>;
  if (type === "image") {
    const items = (b.data ?? []) as { url?: string; b64_json?: string }[];
    return items.map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : "")).filter(Boolean).join("\n") || JSON.stringify(b);
  }
  if (type === "embedding") {
    const vec = b.data?.[0]?.embedding as number[] | undefined;
    return vec ? `embedding with ${vec.length} dimensions: [${vec.slice(0, 8).map((n) => n.toFixed(4)).join(", ")}, …]` : JSON.stringify(b);
  }
  if (type === "video") {
    return b.id ? `video job ${b.id} (${b.status ?? "queued"}). Fetch ${config.zeroG.routerBaseUrl()}/videos/${b.id}/content when it is done.` : JSON.stringify(b);
  }
  return b.choices?.[0]?.message?.content ?? JSON.stringify(b);
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

/** POST /v1/api-keys with the management key, as a private key. The Router's docs do not fix the field name of the secret, so accept the likely ones. */
export async function createAgentKey(name: string, trustMode = TRUST_MODE): Promise<string> {
  const management = config.zeroG.managementKey();
  if (!management) throw new RouterError(503, "ZG_MANAGEMENT_KEY is not set.");
  const res = await safeFetch()(`${config.zeroG.routerBaseUrl()}/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${management}` },
    body: JSON.stringify({ name, trust_mode: trustMode }),
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
export interface BrainOptions {
  ownKey?: string;
  modelType?: ModelType;
  model?: string;
  systemPrompt?: string;
}

export async function spinUpBrain(agent: AgentRow, opts: BrainOptions = {}): Promise<BrainRow | null> {
  if (!config.zeroG.enabled()) return null;
  const { ownKey } = opts;
  const modelType = opts.modelType ?? "text";
  let model: RouterModel;
  try {
    if (opts.model) model = { id: opts.model };
    else if (modelType !== "text") throw new RouterError(400, `Pick a model name for a ${modelType} agent.`);
    else model = await resolveModel();
  } catch (err) {
    log.error(`0G Router unreachable while spinning up ${agent.ens_name}`, err);
    born(agent, "brain", `0G brain ✖ the Router is unreachable: ${(err as Error).message}`);
    model = { id: config.zeroG.model() ?? PREFERRED_MODEL };
  }

  let encrypted: string | null = null;
  let keyLabel: string | null = null;
  try {
    if (ownKey) {
      encrypted = encryptSecret(ownKey); // AES-encrypted with KEYSTORE_SECRET, only decrypted inside think()
      keyLabel = `${ownKey.slice(0, 5)}…${ownKey.slice(-4)}`;
      born(agent, "brain-key", "0G brain key ✓ (your own key)");
    } else {
      // A private key could never reach a video model, so media agents' keys stay standard and each call sets its mode.
      encrypted = encryptSecret(await createAgentKey(agent.ens_name, modelType === "text" ? TRUST_MODE : "standard"));
      keyLabel = agent.ens_name;
      born(agent, "brain-key", "0G brain key ✓");
    }
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
    model_type: modelType,
    system_prompt: opts.systemPrompt?.trim() || null,
  });

  if (modelType !== "text") return getBrain(agent.key) ?? null; // no text first thought for image/video/embedding agents

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

// ---------------------------------------------------------------- provider settings

export interface BrainUpdate {
  modelType?: ModelType;
  model?: string;
  systemPrompt?: string;
  zgApiKey?: string;
}

/** Provider edits their agent's model, system prompt or own 0G key. The key is stored encrypted and never returned. */
export function updateBrainSettings(agent: AgentRow, update: BrainUpdate): BrainRow {
  const current =
    getBrain(agent.key) ??
    upsertBrain({
      agent_key: agent.key,
      api_key_enc: null,
      key_label: null,
      model: currentModelId(),
      credit_neuron: config.zeroG.seedCreditNeuron().toString(),
      spent_neuron: "0",
      earned_units: "0",
      credited_from_earnings_neuron: "0",
      last_request_id: null,
    });
  const key = update.zgApiKey?.trim();
  return upsertBrain({
    ...current,
    model_type: update.modelType ?? current.model_type ?? "text",
    model: update.model?.trim() || current.model,
    system_prompt: update.systemPrompt !== undefined ? update.systemPrompt.trim() || null : (current.system_prompt ?? null),
    api_key_enc: key ? encryptSecret(key) : current.api_key_enc,
    key_label: key ? `${key.slice(0, 5)}…${key.slice(-4)}` : current.key_label,
  });
}

export function brainSettingsView(agent: AgentRow): AgentConfigView {
  const brain = getBrain(agent.key);
  return {
    modelType: (brain?.model_type as ModelType | undefined) ?? "text",
    model: brain?.model ?? currentModelId(),
    systemPrompt: brain?.system_prompt ?? "",
    keyLabel: brain?.key_label ?? null,
    tools: listAgentTools(agent.key).map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      url: t.url,
      description: t.description,
      hasAuth: Boolean(t.auth_enc),
    })),
  };
}
