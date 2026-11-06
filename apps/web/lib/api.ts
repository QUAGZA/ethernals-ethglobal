/**
 * Typed client for the Ethernals server. Every call goes to the same origin; Next
 * rewrites /api/* to the server, and the session is an HTTP-only cookie.
 */
import type {
  ChainTask,
  AgentDetail,
  AgentSummary,
  ApiError,
  ArenaRunRequest,
  ArenaState,
  AddAgentToolRequest,
  AgentBrainView,
  AgentConfigView,
  UpdateAgentConfigRequest,
  ConnectNameraRequest,
  CreateAgentRequest,
  CreateDuelRequest,
  CreateTaskRequest,
  DraftTestsRequest,
  DraftTestsResponse,
  DevLoginRequest,
  HireRequest,
  HireResponse,
  HireView,
  InferenceReceipt,
  MeResponse,
  ProofView,
  PublicConfig,
  RateResponse,
  RpContext,
  SpendPolicyView,
  SpendStateView,
  StatsResponse,
  PublishedTests,
  TaskSpec,
  TaskView,
  TryOverspendResponse,
  VerifierHealth,
  RunProofRequest,
  SandboxRunView,
  StartSandboxRunRequest,
  SubcontractRequest,
  SubcontractResponse,
  WorldVerifyRequest,
} from "@ethernals/shared";

/** The server's task view, with fields the shared type does not carry yet. */
export interface TaskDetail extends TaskView {
  hire: HireView | null;
  scoreChange: { before: string | null; after: string | null } | null;
  duelId: string | null;
  refundableAt: string | null;
  refundable: boolean;
}

export interface DuelDetail {
  id: string;
  tasks: [TaskDetail, TaskDetail];
}

export type AgentDetailPlus = AgentDetail & { erc8004AgentId: string | null; tasksPassed: number; tasksFailed: number };

export type TaskTemplate = Pick<TaskSpec, "title" | "repoUrl" | "baseCommit" | "issue"> & { id: "slugify" };

export const SERVER_DOWN_HINT = "Is the server running? Start everything with pnpm dev";

/** An API failure with the server's plain-English message and hint. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Turns anything thrown into something the UI can show (message + hint). */
export function toApiError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  if (err instanceof Error) return new ApiRequestError(0, err.message);
  return new ApiRequestError(0, String(err));
}

type RequestOptions = { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal };

async function request<T>(path: string, { method = "GET", body, signal }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiRequestError(0, "Could not reach the Ethernals server.", SERVER_DOWN_HINT);
  }

  const text = await res.text();
  let json: unknown = undefined;
  let isJson = false;
  if (text) {
    try {
      json = JSON.parse(text);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  if (!res.ok) {
    const apiError = isJson ? (json as Partial<ApiError> | null) : null;
    if (apiError && typeof apiError.error === "string") {
      throw new ApiRequestError(res.status, apiError.error, apiError.hint);
    }
    // A non-JSON error means the proxy could not reach the server (or the route does not exist).
    throw new ApiRequestError(res.status, `The server did not answer properly (HTTP ${res.status}).`, SERVER_DOWN_HINT);
  }
  if (text && !isJson) {
    throw new ApiRequestError(res.status, "The server sent a response that is not JSON.", SERVER_DOWN_HINT);
  }
  return json as T;
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ?? {} });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} });

export const api = {
  config: () => get<PublicConfig>("/api/config"),
  stats: () => get<StatsResponse>("/api/stats"),

  rpContext: () => get<RpContext>("/api/auth/world/rp-context"),
  worldVerify: (body: WorldVerifyRequest) => post<MeResponse>("/api/auth/world/verify", body),
  devLogin: (body: DevLoginRequest) => post<MeResponse>("/api/auth/dev", body),
  logout: () => post<unknown>("/api/auth/logout"),

  me: () => get<MeResponse>("/api/me"),
  expirePass: () => post<MeResponse>("/api/me/expire-pass"),
  restorePass: () => post<MeResponse>("/api/me/restore-pass"),

  agents: () => get<AgentSummary[]>("/api/agents"),
  agent: (label: string) => get<AgentDetailPlus>(`/api/agents/${encodeURIComponent(label)}`),
  agentBrain: (label: string) => get<AgentBrainView>(`/api/agents/${encodeURIComponent(label)}/brain`),
  agentInference: (label: string) => get<InferenceReceipt[]>(`/api/agents/${encodeURIComponent(label)}/inference`),
  agentConfig: (label: string) => get<AgentConfigView>(`/api/agents/${encodeURIComponent(label)}/config`),
  updateAgentConfig: (label: string, body: UpdateAgentConfigRequest) => put<AgentConfigView>(`/api/agents/${encodeURIComponent(label)}/config`, body),
  hostHere: (label: string) => post<{ ok: boolean; endpoint: string }>(`/api/agents/${encodeURIComponent(label)}/host-here`),
  addAgentTool: (label: string, body: AddAgentToolRequest) => post<AgentConfigView>(`/api/agents/${encodeURIComponent(label)}/tools`, body),
  deleteAgentTool: (label: string, id: string) => del<AgentConfigView>(`/api/agents/${encodeURIComponent(label)}/tools/${encodeURIComponent(id)}`),
  createAgent: (body: CreateAgentRequest) => post<AgentSummary>("/api/agents", body),

  hire: (body: HireRequest) => post<HireResponse>("/api/hires", body),
  rate: (hireId: string, rating: number) => post<RateResponse>(`/api/hires/${encodeURIComponent(hireId)}/rate`, { rating }),
  getHire: (hireId: string) => get<HireView>(`/api/hires/${encodeURIComponent(hireId)}`),

  tasks: () => get<TaskDetail[]>("/api/tasks"),
  chainTasks: () => get<ChainTask[]>("/api/tasks/chain"),
  task: (id: string) => get<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}`),
  taskTemplates: () => get<TaskTemplate[]>("/api/tasks/templates"),
  createTask: (body: CreateTaskRequest) => post<TaskDetail>("/api/tasks", body),
  draftTests: (body: DraftTestsRequest) => post<DraftTestsResponse>("/api/tasks/draft-tests", body),
  taskTests: (id: string) => get<PublishedTests>(`/api/tasks/${encodeURIComponent(id)}/tests.json`),
  hireForTask: (id: string, specialist: string) => post<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}/hire`, { specialist }),
  refundTask: (id: string) => post<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}/refund`),
  createDuel: (body: CreateDuelRequest) => post<DuelDetail>("/api/duels", body),
  duel: (id: string) => get<DuelDetail>(`/api/duels/${encodeURIComponent(id)}`),
  verifierHealth: () => get<VerifierHealth>("/api/verifier/health"),

  spend: () => get<SpendStateView>("/api/me/spend"),
  connectNamera: (body: ConnectNameraRequest) => post<SpendPolicyView>("/api/me/spend/connect", body),
  disconnectNamera: () => request<{ ok: boolean }>("/api/me/spend", { method: "DELETE" }),
  tryOverspend: () => post<TryOverspendResponse>("/api/me/spend/try-overspend"),

  sandboxRuns: () => get<SandboxRunView[]>("/api/sandbox/runs"),
  sandboxRun: (id: string) => get<SandboxRunView>(`/api/sandbox/runs/${encodeURIComponent(id)}`),
  startSandboxRun: (body: StartSandboxRunRequest) => post<SandboxRunView>("/api/sandbox/runs", body),
  stopSandboxRun: (id: string) => post<SandboxRunView>(`/api/sandbox/runs/${encodeURIComponent(id)}/stop`),

  proofs: () => get<ProofView[]>("/api/proofs"),
  runProof: (body: RunProofRequest) => post<ProofView>("/api/proofs/demo", body),
  subcontract: (body: SubcontractRequest) => post<SubcontractResponse>("/api/proofs/subcontract", body),

  arenaState: () => get<ArenaState>("/api/arena/state"),
  runOpenAttack: () => post<ArenaState>("/api/arena/open/run"),
  runEthernalsAttack: (body: ArenaRunRequest) => post<ArenaState>("/api/arena/ethernals/run", body),
};
