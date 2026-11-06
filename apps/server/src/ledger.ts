/**
 * HireLedger on Hedera testnet EVM (chain 296) via the Hashio JSON-RPC relay.
 * The operator's ECDSA key is the verifier. All writes go through one serial queue; hire records are batched.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hederaTestnet } from "viem/chains";
import { hireLedgerAbi, hireLedgerBytecode, reasonFromIndex, type LedgerReason } from "@ethernals/shared";
import { config } from "./config";
import { operatorEvmKey } from "./hedera";
import { Batcher, SerialQueue } from "./queue";

const chain = { ...hederaTestnet, rpcUrls: { default: { http: [config.hedera.rpcUrl] } } };

export const hederaPublic = createPublicClient({ chain, transport: http(config.hedera.rpcUrl, { timeout: 60_000 }) });

function wallet() {
  const account = privateKeyToAccount(operatorEvmKey());
  return createWalletClient({ account, chain, transport: http(config.hedera.rpcUrl, { timeout: 60_000 }) });
}

const writes = new SerialQueue();

export interface HireInput {
  agentKey: Hex;
  buyerPersonHash: Hex;
  paymentRef: Hex;
  paymentTxId: string;
  amountPaid: bigint;
  rating: number;
  consentHash: Hex;
  parentHireRef: Hex;
}

export interface HireRecordResult {
  paymentTxId: string;
  counted: boolean;
  reason: LedgerReason;
  scoreX1e6: bigint;
  price: bigint;
  txHash: Hex;
}

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export function paymentRef(txId: string): Hex {
  return keccak256(stringToHex(txId));
}

export async function deployLedger(): Promise<{ address: Hex; txHash: Hex }> {
  const w = wallet();
  const hash = await w.deployContract({
    abi: hireLedgerAbi,
    bytecode: hireLedgerBytecode,
    args: [w.account.address],
  });
  const receipt = await hederaPublic.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (!receipt.contractAddress) throw new Error("Deployment receipt has no contract address.");
  return { address: receipt.contractAddress, txHash: hash };
}

function ledgerAddress(): Hex {
  return config.hedera.ledgerAddress();
}

export async function isAgentRegistered(agentKey: Hex): Promise<boolean> {
  return hederaPublic.readContract({ address: ledgerAddress(), abi: hireLedgerAbi, functionName: "isRegistered", args: [agentKey] });
}

export async function registerAgentOnLedger(params: {
  agentKey: Hex;
  providerKey: Hex;
  providerPersonHash: Hex;
  basePrice: bigint;
}): Promise<Hex | null> {
  if (await isAgentRegistered(params.agentKey)) return null;
  return writes.run(async () => {
    const hash = await wallet().writeContract({
      address: ledgerAddress(),
      abi: hireLedgerAbi,
      functionName: "registerAgent",
      args: [params.agentKey, params.providerKey, params.providerPersonHash, params.basePrice],
    });
    const receipt = await hederaPublic.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("registerAgent reverted on the HireLedger.");
    return hash;
  });
}

async function flushHires(items: HireInput[]): Promise<HireRecordResult[]> {
  return writes.run(async () => {
    const hash = await wallet().writeContract({
      address: ledgerAddress(),
      abi: hireLedgerAbi,
      functionName: "recordHires",
      args: [items.map((h) => ({ ...h, rating: h.rating }))],
    });
    const receipt = await hederaPublic.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("recordHires reverted on the HireLedger.");
    const events = parseEventLogs({ abi: hireLedgerAbi, logs: receipt.logs, eventName: "HireRecorded" });
    return items.map((item) => {
      const ev = events.find((e) => e.args.paymentTxId === item.paymentTxId);
      if (!ev) throw new Error(`No HireRecorded event for ${item.paymentTxId}`);
      return {
        paymentTxId: item.paymentTxId,
        counted: ev.args.counted,
        reason: reasonFromIndex(Number(ev.args.reason)),
        scoreX1e6: ev.args.newScoreX1e6,
        price: ev.args.newPrice,
        txHash: hash,
      };
    });
  });
}

const hireBatcher = new Batcher<HireInput, HireRecordResult>(flushHires, 25, 1500);

/** Queues a hire for the next batched `recordHires` transaction and resolves with its own outcome. */
export function recordHire(input: HireInput): Promise<HireRecordResult> {
  return hireBatcher.add(input);
}

export interface LedgerStats {
  votes: number;
  sumVotes: number;
  hiresTotal: number;
  hiresCounted: number;
  basePrice: bigint;
  providerKey: Hex;
  scoreX1e6: bigint;
  price: bigint;
}

export async function getStats(agentKey: Hex): Promise<LedgerStats> {
  const address = ledgerAddress();
  const [stats, score, price] = await Promise.all([
    hederaPublic.readContract({ address, abi: hireLedgerAbi, functionName: "statsOf", args: [agentKey] }),
    hederaPublic.readContract({ address, abi: hireLedgerAbi, functionName: "scoreOf", args: [agentKey] }),
    hederaPublic.readContract({ address, abi: hireLedgerAbi, functionName: "priceOf", args: [agentKey] }),
  ]);
  const [votes, sumVotes, hiresTotal, hiresCounted, basePrice, providerKey] = stats;
  return {
    votes: Number(votes),
    sumVotes: Number(sumVotes),
    hiresTotal: Number(hiresTotal),
    hiresCounted: Number(hiresCounted),
    basePrice,
    providerKey,
    scoreX1e6: score,
    price,
  };
}

export async function getPrice(agentKey: Hex): Promise<bigint> {
  return hederaPublic.readContract({ address: ledgerAddress(), abi: hireLedgerAbi, functionName: "priceOf", args: [agentKey] });
}
