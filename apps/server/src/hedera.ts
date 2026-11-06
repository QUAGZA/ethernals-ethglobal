/**
 * Hedera helpers: agent accounts, USDC association, funding transfers, balances and mirror-node payment checks.
 * SDK classes come from @x402/hedera's re-exports so the app and x402 share one SDK instance.
 */
import {
  AccountId,
  AccountInfoQuery,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
} from "@x402/hedera";
import { toMirrorTxId } from "@ethernals/shared";
import { config, normalizeEcdsaKey } from "./config";
import { log } from "./events";

export function parseEcdsaKey(hexKey: string): PrivateKey {
  return PrivateKey.fromStringECDSA(normalizeEcdsaKey(hexKey).slice(2));
}

let operator: Client | null = null;
export function operatorClient(): Client {
  if (operator) return operator;
  operator = Client.forTestnet().setOperator(
    AccountId.fromString(config.hedera.operatorId()),
    parseEcdsaKey(config.hedera.operatorKey()),
  );
  return operator;
}

export function operatorEvmKey(): `0x${string}` {
  return normalizeEcdsaKey(config.hedera.operatorKey());
}

/** Payment asset id used in x402 requirements: HTS token id for USDC, "0.0.0" for HBAR. */
export function paymentAssetId(): string {
  return config.hedera.paymentAsset === "USDC" ? config.hedera.usdcTokenId : "0.0.0";
}

/**
 * Prices are kept in 6-decimal "units" everywhere. For USDC that is the token's own unit.
 * In HBAR fallback mode, 1 unit = 1e-6 HBAR = 100 tinybars.
 */
export function unitsToAssetAmount(units: bigint): bigint {
  return config.hedera.paymentAsset === "USDC" ? units : units * 100n;
}
export function assetAmountToUnits(amount: bigint): bigint {
  return config.hedera.paymentAsset === "USDC" ? amount : amount / 100n;
}

export interface NewAccount {
  accountId: string;
  evmAddress: `0x${string}`;
  privateKeyHex: `0x${string}`;
}

/**
 * Creates a new ECDSA account by sending HBAR to its key alias (auto account creation),
 * then associates USDC so it can send and receive the payment token.
 */
export async function createAgentAccount(initialHbar = Number(config.hedera.agentStartingHbar), privateKeyHex?: string): Promise<NewAccount> {
  const client = operatorClient();
  const key = privateKeyHex ? PrivateKey.fromStringECDSA(privateKeyHex.replace(/^0x/, "")) : PrivateKey.generateECDSA();
  const alias = key.publicKey.toAccountId(0, 0);
  const operatorId = AccountId.fromString(config.hedera.operatorId());

  const transfer = await new TransferTransaction()
    .addHbarTransfer(operatorId, new Hbar(-initialHbar))
    .addHbarTransfer(alias, new Hbar(initialHbar))
    .execute(client);
  await transfer.getReceipt(client);

  let accountId: string | null = null;
  for (let attempt = 0; attempt < 10 && !accountId; attempt++) {
    try {
      const info = await new AccountInfoQuery().setAccountId(alias).execute(client);
      accountId = info.accountId.toString();
    } catch {
      await sleep(1500);
    }
  }
  if (!accountId) throw new Error("Hedera created the account but it could not be looked up yet. Try again in a minute.");

  if (config.hedera.paymentAsset === "USDC") {
    await associateUsdc(accountId, key);
  }

  return {
    accountId,
    evmAddress: `0x${key.publicKey.toEvmAddress()}`,
    privateKeyHex: `0x${key.toStringRaw()}`,
  };
}

export async function associateUsdc(accountId: string, key: PrivateKey): Promise<"associated" | "already"> {
  const client = operatorClient();
  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(accountId))
      .setTokenIds([TokenId.fromString(config.hedera.usdcTokenId)])
      .freezeWith(client)
      .sign(key);
    await (await tx.execute(client)).getReceipt(client);
    return "associated";
  } catch (err) {
    if (String(err).includes("TOKEN_ALREADY_ASSOCIATED")) return "already";
    throw err;
  }
}

/** Operator → account transfer of the payment asset (6-decimal units). */
export async function fundFromOperator(accountId: string, units: bigint): Promise<string> {
  const client = operatorClient();
  const operatorId = AccountId.fromString(config.hedera.operatorId());
  const to = AccountId.fromString(accountId);
  const tx = new TransferTransaction();
  if (config.hedera.paymentAsset === "USDC") {
    const token = TokenId.fromString(config.hedera.usdcTokenId);
    tx.addTokenTransfer(token, operatorId, -units).addTokenTransfer(token, to, units);
  } else {
    const tinybars = unitsToAssetAmount(units);
    tx.addHbarTransfer(operatorId, Hbar.fromTinybars((-tinybars).toString())).addHbarTransfer(to, Hbar.fromTinybars(tinybars.toString()));
  }
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}

/** Sends HBAR from the operator (used to top up agent accounts that create sub-hires or associations). */
export async function sendHbarFromOperator(accountId: string, hbar: number): Promise<void> {
  const client = operatorClient();
  const response = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(config.hedera.operatorId()), new Hbar(-hbar))
    .addHbarTransfer(AccountId.fromString(accountId), new Hbar(hbar))
    .execute(client);
  await response.getReceipt(client);
}

// ---------------- mirror node ----------------

interface MirrorTransfer {
  account: string;
  amount: number;
  token_id?: string;
}
interface MirrorTransaction {
  result: string;
  name: string;
  consensus_timestamp: string;
  transaction_id: string;
  transfers?: MirrorTransfer[];
  token_transfers?: MirrorTransfer[];
}

async function mirrorJson<T>(pathname: string): Promise<T | null> {
  const res = await fetch(`${config.hedera.mirrorUrl}${pathname}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror node ${res.status} for ${pathname}`);
  return (await res.json()) as T;
}

export async function mirrorTransaction(txId: string): Promise<MirrorTransaction | null> {
  const data = await mirrorJson<{ transactions: MirrorTransaction[] }>(`/api/v1/transactions/${toMirrorTxId(txId)}`);
  return data?.transactions?.[0] ?? null;
}

export interface Balances {
  hbar: string; // HBAR as decimal string
  usdcUnits: bigint;
  usdcAssociated: boolean;
}

export async function getBalances(accountId: string): Promise<Balances> {
  const data = await mirrorJson<{ balance: { balance: number; tokens: { token_id: string; balance: number }[] } }>(
    `/api/v1/accounts/${accountId}`,
  );
  if (!data) return { hbar: "0", usdcUnits: 0n, usdcAssociated: false };
  const token = data.balance.tokens.find((t) => t.token_id === config.hedera.usdcTokenId);
  return {
    hbar: (data.balance.balance / 1e8).toFixed(4),
    usdcUnits: BigInt(token?.balance ?? 0),
    usdcAssociated: Boolean(token),
  };
}

/** Balance of the payment asset in 6-decimal units. */
export async function getPaymentBalanceUnits(accountId: string): Promise<bigint> {
  const b = await getBalances(accountId);
  if (config.hedera.paymentAsset === "USDC") return b.usdcUnits;
  return BigInt(Math.floor(Number(b.hbar) * 1e6));
}

export interface PaymentCheck {
  ok: boolean;
  reason?: string;
  amountUnits?: bigint;
  consensusTimestamp?: string;
}

/**
 * Confirms on the mirror node that `txId` succeeded and moved at least `minUnits` of the payment asset
 * from `payer` to `payee`. Polls for up to ~40 s because the mirror node lags consensus by a few seconds.
 */
export async function verifyPaymentOnMirror(params: {
  txId: string;
  payer: string;
  payee: string;
  minUnits: bigint;
  timeoutMs?: number;
}): Promise<PaymentCheck> {
  const deadline = Date.now() + (params.timeoutMs ?? 40_000);
  let tx: MirrorTransaction | null = null;
  while (!tx && Date.now() < deadline) {
    try {
      tx = await mirrorTransaction(params.txId);
    } catch (err) {
      log.warn("mirror lookup failed, retrying", { error: String(err) });
    }
    if (!tx) await sleep(2000);
  }
  if (!tx) return { ok: false, reason: "Payment transaction not found on the mirror node." };
  if (tx.result !== "SUCCESS") return { ok: false, reason: `Payment transaction result was ${tx.result}.` };

  const isUsdc = config.hedera.paymentAsset === "USDC";
  const rows = isUsdc
    ? (tx.token_transfers ?? []).filter((t) => t.token_id === config.hedera.usdcTokenId)
    : (tx.transfers ?? []);
  const received = rows.filter((t) => t.account === params.payee && t.amount > 0).reduce((s, t) => s + BigInt(t.amount), 0n);
  const sent = rows.filter((t) => t.account === params.payer && t.amount < 0).reduce((s, t) => s - BigInt(t.amount), 0n);
  const receivedUnits = assetAmountToUnits(received);

  if (sent === 0n) return { ok: false, reason: "The payment did not come from the buyer agent's account." };
  if (receivedUnits < params.minUnits) {
    return { ok: false, reason: `Paid ${receivedUnits} units, less than the quoted ${params.minUnits}.` };
  }
  return { ok: true, amountUnits: receivedUnits, consensusTimestamp: tx.consensus_timestamp };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The EVM address a Hedera account is keyed to (from the mirror node), or null when it does not exist. */
export async function accountEvmAddress(accountId: string): Promise<string | null> {
  const data = await mirrorJson<{ evm_address?: string; key?: { key?: string } }>(`/api/v1/accounts/${accountId}`);
  return data?.evm_address ? data.evm_address.toLowerCase() : null;
}
