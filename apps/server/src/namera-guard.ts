/**
 * The Namera spend guard: a person's smart account pays, and the server holds only a session key whose on-chain policy
 * limits what it can do. The person creates that key in dashboard.namera.ai and pastes three values on the site.
 * A policy block is a normal outcome, returned and shown, never thrown. The API key is never logged.
 */
import { ESCROW_CHAIN_ID, formatUnits6 } from "@ethernals/shared";
import type { Hex, SpendGuard, SpendPolicyView, SpendRequest, SpendResult } from "@ethernals/shared";
import type { NameraClient } from "@namera-ai/sdk";
import { config } from "./config";
import { AppError } from "./errors";

const POLL_MS = 2000;
const POLL_LIMIT_MS = 120_000;
const SETUP_HINT = "In dashboard.namera.ai, approve the session key's installation on Sepolia, then connect it again.";

interface NameraFailure {
  message: string;
  kind?: string;
  code?: string;
  tag?: string;
  status?: number | null;
}
type NameraResult<T> = { success: true; data: T; error: null } | { success: false; data: null; error: NameraFailure };

/** Response shapes come from the SDK's own types, so a wrong field name fails the typecheck. */
type Data<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>> extends infer R ? (R extends { success: true; data: infer D } ? D : never) : never;
type SessionKey = Data<NameraClient["sessionKeys"]["get"]>;
type Installation = SessionKey["installations"][number];
export type NameraPermission = Installation["authorization"]["permissions"][number];
type ExecuteRequest = Parameters<NameraClient["executions"]["execute"]>[0];

/** The parts of the SDK this guard uses. */
export interface NameraLike {
  sessionKeys: { get(id: string): Promise<NameraResult<SessionKey>> };
  executions: {
    execute(request: ExecuteRequest): Promise<NameraResult<Data<NameraClient["executions"]["execute"]>>>;
    getStatus(submissionId: string): Promise<NameraResult<Data<NameraClient["executions"]["getStatus"]>>>;
  };
}

export interface NameraGuardOptions {
  apiKey: string;
  walletId: string;
  sessionKeyId: string;
  apiUrl?: string;
  client?: NameraLike;
  pollMs?: number;
  pollLimitMs?: number;
}

/** Turns a Namera refusal into something a person can act on. Never includes the API key. */
function explain(error: NameraFailure): AppError {
  if (error.kind === "contract") return new AppError(400, "The wallet id or session key id isn't in Namera's format.", "Copy each id from the Namera dashboard: they look like 0198f3a2-7c4e-7abc-8def-1234567890ab, not a name.");
  if (error.status === 401 || error.tag === "Unauthorized") return new AppError(400, "Namera didn't accept this API key.", "Check you copied all of it, and that it hasn't been revoked.");
  if (error.status === 403 || error.tag === "Forbidden" || error.code === "MANAGEMENT_PERMISSION_DENIED") return new AppError(400, "This API key can't read that session key.", "Give the API key the session-key:read and wallet:read permissions, and access to this session key.");
  return new AppError(400, `Namera said: ${error.message}`, "Check the three values in your Namera dashboard.");
}

/** Which policy rule an error came from, or null if it isn't a policy block. */
export function blockRule(error: { message?: string; code?: string; tag?: string }): string | null {
  const text = `${error.tag ?? ""} ${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (/ratelimitexceeded|rate_limit_exceeded/.test(text)) return null; // Namera's own API throttle, not a session policy
  if (/allowance|spending limit|exceeds.*(limit|budget)/.test(text)) return "token-allowance";
  if (/contract.*(access|allow)|not allowed.*contract/.test(text)) return "contract-access";
  if (/rate.?limit/.test(text)) return "rate-limit";
  if (/expired|revoked|not installed/.test(text)) return "expired";
  if (/policy|permission|denied/.test(text)) return "policy";
  return null;
}

function statusOf(keyStatus: string, install: Installation, validUntil: number): SpendPolicyView["status"] {
  if (keyStatus === "revoked" || keyStatus === "revoking" || install.status === "revoked" || install.status === "revoking") return "revoked";
  if (validUntil * 1000 <= Date.now()) return "expired";
  return install.status === "installed" ? "active" : "unknown";
}

export function createNameraGuard(options: NameraGuardOptions): SpendGuard {
  const { apiKey, walletId, sessionKeyId, apiUrl } = options;
  const pollMs = options.pollMs ?? POLL_MS;
  const pollLimitMs = options.pollLimitMs ?? POLL_LIMIT_MS;
  let client = options.client ?? null;

  async function namera(): Promise<NameraLike> {
    if (!client) {
      const { NameraClient } = await import("@namera-ai/sdk");
      client = new NameraClient({ apiKey, localSigning: false, ...(apiUrl ? { baseUrl: apiUrl } : {}) }) as unknown as NameraLike;
    }
    return client;
  }

  async function sessionKey(): Promise<SessionKey> {
    const key = await (await namera()).sessionKeys.get(sessionKeyId);
    if (!key.success) throw explain(key.error);
    if (key.data.wallet.id !== walletId) throw new AppError(400, "This session key belongs to a different account.", "Copy the wallet id of the account the session key was created for.");
    return key.data;
  }

  return {
    kind: "namera",
    address: async () => (await sessionKey()).wallet.address as Hex,

    async policy(): Promise<SpendPolicyView> {
      const key = await sessionKey();
      if (key.signer.custody === "local") throw new AppError(400, "This session key is held on your own machine, so our server can't use it.", "Create one with Namera-managed signing (signer: Namera) instead.");
      const install = key.installations.find((i) => i.chainId === ESCROW_CHAIN_ID);
      if (!install) throw new AppError(400, "This session key isn't set up for Sepolia.", SETUP_HINT);
      const { permissions, validUntil } = install.authorization;
      const token = config.escrow.tokenOrNull()?.toLowerCase();
      const cap = permissions.find((p) => p.type === "erc20-token-transfer" && p.address.toLowerCase() === token);
      return {
        guard: "namera",
        accountAddress: key.wallet.address as Hex,
        chainId: ESCROW_CHAIN_ID,
        sessionKeyId,
        status: statusOf(key.status, install, validUntil),
        allowedContracts: permissions.flatMap((p) => (p.type === "contract-access" ? [p.address as Hex] : [])),
        tokenAllowanceUsdc: cap?.type === "erc20-token-transfer" ? formatUnits6(cap.allowance) : null,
        rateLimit: null, // Namera's on-chain permissions have no call-rate limit
        validUntil: new Date(validUntil * 1000).toISOString(),
        source: "namera-api",
      };
    },

    async execute(request: SpendRequest): Promise<SpendResult> {
      const refuse = (error: NameraFailure): SpendResult => {
        const rule = blockRule(error);
        return rule ? { status: "blocked", guard: "namera", reason: error.message, rule } : { status: "failed", guard: "namera", error: error.message };
      };
      try {
        const api = await namera();
        const calls = request.calls.map((call) => ({ to: call.to as never, data: call.data, value: BigInt(call.value ?? "0") }));
        const sent = await api.executions.execute({ namespace: "eip155", walletId: walletId as never, sessionKeyId: sessionKeyId as never, chainId: request.chainId, calls, sponsor: true });
        if (!sent.success) return refuse(sent.error);
        const { submissionId } = sent.data;
        const deadline = Date.now() + pollLimitMs;
        while (Date.now() < deadline) {
          const state = await api.executions.getStatus(submissionId);
          if (!state.success) return refuse(state.error);
          if (state.data.status === "confirmed") {
            return { status: "confirmed", guard: "namera", txHash: state.data.execution.data.transactionHash as Hex, submissionId };
          }
          if (state.data.status === "failed" || state.data.status === "cancelled") {
            return { status: "failed", guard: "namera", error: `Namera reported the execution as ${state.data.status}.` };
          }
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
        return { status: "failed", guard: "namera", error: "Namera didn't confirm the payment in time." };
      } catch (err) {
        return { status: "failed", guard: "namera", error: (err as Error).message.split("\n")[0] };
      }
    },
  };
}
