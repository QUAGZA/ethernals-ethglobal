/**
 * Spending controls. Every bounty goes through a SpendGuard:
 *  - Namera: a session key limited by on-chain policy;
 *  - DirectGuard: the buyer agent's own key with limits checked only by this server, labelled weaker in the UI.
 * A block is a normal outcome, recorded and shown, never an exception.
 */
import { formatUnits6, parseUnits6, sepoliaTxUrl, ESCROW_CHAIN_ID } from "@ethernals/shared";
import type { Hex, SpendEventView, SpendGuard, SpendGuardKind, SpendPolicyView, SpendRequest, SpendResult } from "@ethernals/shared";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "./config";
import { decryptSecret, encryptSecret, randomId } from "./crypto";
import {
  countConfirmedSpends,
  getSpendAccount,
  insertSpendEvent,
  type AgentRow,
  type PersonRow,
  type SpendEventRow,
} from "./db";
import { sepoliaPublic } from "./ens";
import { badRequest } from "./errors";
import { emit } from "./events";
import { createNameraGuard } from "./namera-guard";
import { SerialQueue } from "./queue";

export const MAX_DIRECT_BOUNTY_USDC = 10;
export const MAX_DIRECT_SPENDS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

const senderQueues = new Map<string, SerialQueue>();

/** One transaction at a time per Sepolia sender, so nonces never collide. */
export function queueFor(address: string): SerialQueue {
  const key = address.toLowerCase();
  let queue = senderQueues.get(key);
  if (!queue) {
    queue = new SerialQueue();
    senderQueues.set(key, queue);
  }
  return queue;
}

export type CallSender = (call: { to: Hex; data: Hex; value: bigint }) => Promise<Hex>;

function agentSender(buyer: AgentRow): CallSender {
  return async (call) => {
    // Built on first use, so reading a policy needs no RPC settings.
    const account = privateKeyToAccount(decryptSecret(buyer.enc_private_key) as Hex);
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(config.sepolia.rpcUrl(), { timeout: 60_000 }) });
    const hash = await wallet.sendTransaction(call);
    const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
    return hash;
  };
}

/** The fallback guard. Its limits live on this server, so a compromised server could ignore them. */
export class DirectGuard implements SpendGuard {
  readonly kind = "direct" as const;

  constructor(
    private readonly person: Pick<PersonRow, "id">,
    private readonly accountAddress: Hex,
    private readonly send: CallSender,
  ) {}

  async address(): Promise<Hex> {
    return this.accountAddress;
  }

  async policy(): Promise<SpendPolicyView> {
    return {
      guard: "direct",
      accountAddress: this.accountAddress,
      chainId: ESCROW_CHAIN_ID,
      sessionKeyId: null,
      status: "active",
      allowedContracts: [config.escrow.tokenOrNull(), config.escrow.addressOrNull()].filter((a): a is Hex => a !== null),
      tokenAllowanceUsdc: formatUnits6(parseUnits6(String(MAX_DIRECT_BOUNTY_USDC))),
      rateLimit: `${MAX_DIRECT_SPENDS_PER_HOUR} per hour`,
      validUntil: null,
      source: "local",
    };
  }

  async execute(request: SpendRequest): Promise<SpendResult> {
    if (parseUnits6(request.amountUsdc) > parseUnits6(String(MAX_DIRECT_BOUNTY_USDC))) {
      return { status: "blocked", guard: "direct", rule: "direct-cap", reason: `${request.amountUsdc} tUSDC is above the ${MAX_DIRECT_BOUNTY_USDC} tUSDC cap per bounty.` };
    }
    const since = new Date(Date.now() - HOUR_MS).toISOString();
    if (countConfirmedSpends(this.person.id, "direct", since) >= MAX_DIRECT_SPENDS_PER_HOUR) {
      return { status: "blocked", guard: "direct", rule: "direct-cap", reason: `Limit reached: ${MAX_DIRECT_SPENDS_PER_HOUR} bounties per hour.` };
    }
    try {
      return await queueFor(this.accountAddress).run(async () => {
        let txHash: Hex = "0x";
        for (const call of request.calls) {
          txHash = await this.send({ to: call.to, data: call.data, value: BigInt(call.value ?? "0") });
        }
        return { status: "confirmed", guard: "direct", txHash, submissionId: null } as const;
      });
    } catch (err) {
      return { status: "failed", guard: "direct", error: (err as Error).message.split("\n")[0] };
    }
  }
}

export interface NameraOptions {
  apiKey: string;
  walletId: string;
  sessionKeyId: string;
  apiUrl?: string;
}
type NameraFactory = (options: NameraOptions) => SpendGuard;

let nameraFactory: NameraFactory | null = null;
export function setNameraFactoryForTests(factory: NameraFactory | null): void {
  nameraFactory = factory;
}

export async function buildNameraGuard(options: Omit<NameraOptions, "apiUrl">): Promise<SpendGuard> {
  return (nameraFactory ?? createNameraGuard)({ ...options, apiUrl: config.namera.apiUrl() });
}

/** The person's Namera guard if they connected one, otherwise the DirectGuard on their buyer agent. */
export async function guardFor(person: PersonRow, buyer: AgentRow): Promise<SpendGuard> {
  const account = getSpendAccount(person.id);
  if (account && config.namera.enabled()) {
    return buildNameraGuard({
      apiKey: decryptSecret(account.api_key_enc),
      walletId: account.wallet_id,
      sessionKeyId: account.session_key_id,
    });
  }
  return new DirectGuard(person, buyer.evm_address as Hex, agentSender(buyer));
}

export function encryptNameraKey(apiKey: string): string {
  if (!apiKey.trim()) throw badRequest("Paste your Namera API key.");
  return encryptSecret(apiKey.trim());
}

/** Writes one audit row and tells the UI, for every attempt, allowed or not. */
export function recordSpend(params: {
  person: Pick<PersonRow, "id">;
  taskId: string | null;
  guard: SpendGuardKind;
  purpose: string;
  amountUnits: bigint;
  result: SpendResult;
}): SpendEventRow {
  const { result } = params;
  const row = insertSpendEvent({
    id: randomId("spend"),
    person_id: params.person.id,
    task_id: params.taskId,
    guard: params.guard,
    purpose: params.purpose,
    amount_units: params.amountUnits.toString(),
    status: result.status,
    rule: result.status === "blocked" ? result.rule : null,
    reason: result.status === "blocked" ? result.reason : result.status === "failed" ? result.error : null,
    tx_hash: result.status === "confirmed" ? result.txHash : null,
  });
  const amount = formatUnits6(params.amountUnits);
  if (result.status === "confirmed") {
    emit("spend.allowed", { taskId: params.taskId, amount, txUrl: sepoliaTxUrl(result.txHash), message: `${params.guard} guard allowed ${amount} tUSDC: ${params.purpose}` });
  } else if (result.status === "blocked") {
    emit("spend.blocked", { taskId: params.taskId, amount, rule: result.rule, reason: result.reason as never, message: `${params.guard} guard blocked ${amount} tUSDC: ${result.reason}` });
  }
  return row;
}

export function spendEventView(row: SpendEventRow): SpendEventView {
  return {
    at: row.created_at,
    guard: row.guard,
    purpose: row.purpose,
    amountUsdc: formatUnits6(BigInt(row.amount_units)),
    status: row.status,
    rule: row.rule,
    reason: row.reason,
    txUrl: row.tx_hash ? sepoliaTxUrl(row.tx_hash) : null,
  };
}
