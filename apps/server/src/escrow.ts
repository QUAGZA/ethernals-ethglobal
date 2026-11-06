/**
 * TaskEscrow and tUSDC on Ethereum Sepolia. Funding goes through a SpendGuard; specialists sign with their own keys;
 * platform transactions share the ENS write queue, so no nonce ever collides.
 */
import {
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  ESCROW_CHAIN_ID,
  ESCROW_STATUS,
  MOCK_USDC_MINT_CAP,
  formatUnits6,
  identityRegistryAbi,
  mockUsdcAbi,
  taskEscrowAbi,
  type EscrowStatus,
  type SpendGuard,
  type SpendResult,
} from "@ethernals/shared";
import { config } from "./config";
import { decryptSecret } from "./crypto";
import { updateAgent, type AgentRow, type PersonRow } from "./db";
import { runPlatformSepoliaWrite, sepoliaPublic } from "./ens";
import { log } from "./events";
import { queueFor, recordSpend } from "./spend";

const AGENT_GAS = parseEther("0.01");
const MIN_AGENT_GAS = parseEther("0.003");
const validationRegistryAbi = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
]);

export interface OnChainTask {
  client: Hex;
  specialist: Hex;
  bounty: bigint;
  deadline: bigint;
  specHash: Hex;
  testsHash: Hex;
  patchHash: Hex;
  resultHash: Hex;
  status: EscrowStatus;
}

export async function getTaskOnChain(chainTaskId: string): Promise<OnChainTask> {
  const task = await sepoliaPublic.readContract({
    address: config.escrow.address(),
    abi: taskEscrowAbi,
    functionName: "getTask",
    args: [BigInt(chainTaskId)],
  });
  return { ...task, status: ESCROW_STATUS[task.status] } as OnChainTask;
}

/** Sends Sepolia gas from the platform wallet if the account is low. */
export async function ensureSepoliaGas(address: Hex): Promise<void> {
  const balance = await sepoliaPublic.getBalance({ address });
  if (balance >= MIN_AGENT_GAS) return;
  await runPlatformSepoliaWrite(async (wallet) => {
    const hash = await wallet.sendTransaction({ to: address, value: AGENT_GAS });
    await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
  });
}

/** tUSDC comes from the open faucet, minted by the platform wallet when the account runs low. */
export async function ensureTusdc(address: Hex, units: bigint): Promise<void> {
  const token = config.escrow.token();
  const balance = await sepoliaPublic.readContract({ address: token, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] });
  if (balance >= units) return;
  let missing = units - balance;
  while (missing > 0n) {
    const amount = missing > MOCK_USDC_MINT_CAP ? MOCK_USDC_MINT_CAP : missing;
    await runPlatformSepoliaWrite(async (wallet) => {
      const hash = await wallet.writeContract({ address: token, abi: mockUsdcAbi, functionName: "mint", args: [address, amount] });
      await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    });
    missing -= amount;
  }
}

export interface FundTaskParams {
  person: PersonRow;
  guard: SpendGuard;
  taskId: string | null;
  bountyUnits: bigint;
  deadlineSeconds: bigint;
  specialist: Hex;
  specHash: Hex;
  testsHash: Hex;
  specURI: string;
  purpose: string;
}

export function fundingCalls(p: Pick<FundTaskParams, "bountyUnits" | "deadlineSeconds" | "specialist" | "specHash" | "testsHash" | "specURI">) {
  const escrow = config.escrow.address();
  return [
    {
      to: config.escrow.token(),
      data: encodeFunctionData({ abi: mockUsdcAbi, functionName: "approve", args: [escrow, p.bountyUnits] }),
    },
    {
      to: escrow,
      data: encodeFunctionData({
        abi: taskEscrowAbi,
        functionName: "createTask",
        args: [p.bountyUnits, p.deadlineSeconds, p.specialist, p.specHash, p.testsHash, p.specURI],
      }),
    },
  ];
}

export type FundOutcome =
  | { status: "confirmed"; chainTaskId: string; txHash: Hex }
  | { status: "blocked"; rule: string | null; reason: string }
  | { status: "failed"; error: string };

/** Locks the bounty. A policy block is an answer, not an error: nothing is created and the attempt is recorded. */
export async function fundTask(p: FundTaskParams): Promise<FundOutcome> {
  const address = await p.guard.address();
  const amountUsdc = formatUnits6(p.bountyUnits);
  const policy = await p.guard.policy();
  // A bounty the direct guard will refuse needs no gas or tokens first.
  const directRefusal = p.guard.kind === "direct" && policy.tokenAllowanceUsdc !== null && Number(amountUsdc) > Number(policy.tokenAllowanceUsdc);
  if (!directRefusal) {
    await ensureTusdc(address, p.bountyUnits);
    if (p.guard.kind === "direct") await ensureSepoliaGas(address);
  }

  const result: SpendResult = await p.guard.execute({ chainId: ESCROW_CHAIN_ID, calls: fundingCalls(p), purpose: p.purpose, amountUsdc });
  recordSpend({ person: p.person, taskId: p.taskId, guard: p.guard.kind, purpose: p.purpose, amountUnits: p.bountyUnits, result });
  if (result.status === "blocked") return { status: "blocked", rule: result.rule, reason: result.reason };
  if (result.status === "failed") return { status: "failed", error: result.error };

  const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash: result.txHash, timeout: 180_000 });
  const [created] = parseEventLogs({ abi: taskEscrowAbi, logs: receipt.logs, eventName: "TaskCreated" });
  if (!created) return { status: "failed", error: "The funding transaction emitted no TaskCreated event." };
  return { status: "confirmed", chainTaskId: created.args.taskId.toString(), txHash: result.txHash };
}

async function asAgent(agent: AgentRow, send: (wallet: ReturnType<typeof agentWallet>) => Promise<Hex>): Promise<Hex> {
  return queueFor(agent.evm_address).run(async () => {
    const hash = await send(agentWallet(agent));
    const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
    return hash;
  });
}

function agentWallet(agent: AgentRow) {
  const account = privateKeyToAccount(decryptSecret(agent.enc_private_key) as Hex);
  return createWalletClient({ account, chain: sepolia, transport: http(config.sepolia.rpcUrl(), { timeout: 60_000 }) });
}

export function acceptOnChain(specialist: AgentRow, chainTaskId: string): Promise<Hex> {
  return asAgent(specialist, (wallet) =>
    wallet.writeContract({ address: config.escrow.address(), abi: taskEscrowAbi, functionName: "acceptTask", args: [BigInt(chainTaskId)] }),
  );
}

export function submitOnChain(specialist: AgentRow, chainTaskId: string, patchHash: Hex, patchURI: string): Promise<Hex> {
  return asAgent(specialist, (wallet) =>
    wallet.writeContract({ address: config.escrow.address(), abi: taskEscrowAbi, functionName: "submitResult", args: [BigInt(chainTaskId), patchHash, patchURI] }),
  );
}

/** The refund goes back through the guard: the guard's account is the task's client. */
export async function refundOnChain(person: PersonRow, guard: SpendGuard, taskId: string, chainTaskId: string, bountyUnits: bigint): Promise<SpendResult> {
  const purpose = `refund task ${chainTaskId}`;
  const result = await guard.execute({
    chainId: ESCROW_CHAIN_ID,
    calls: [{ to: config.escrow.address(), data: encodeFunctionData({ abi: taskEscrowAbi, functionName: "refund", args: [BigInt(chainTaskId)] }) }],
    purpose,
    amountUsdc: "0",
  });
  recordSpend({ person, taskId, guard: guard.kind, purpose, amountUnits: bountyUnits, result });
  return result;
}

/** Registers the agent's ERC-8004 identity from the platform wallet. */
export async function registerErc8004(agent: AgentRow): Promise<string> {
  const document = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agent.ens_name,
    description: agent.description,
    services: [{ name: "x402", endpoint: `${config.publicBaseUrl}/a/${agent.label}/task` }],
    capabilities: ["code-fix:python"],
  };
  const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(document)).toString("base64")}`;
  return runPlatformSepoliaWrite(async (wallet) => {
    const hash = await wallet.writeContract({ address: config.erc8004.identity, abi: identityRegistryAbi, functionName: "register", args: [agentURI] });
    const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    const [registered] = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: "Registered" });
    if (!registered) throw new Error("ERC-8004 register() did not emit Registered.");
    const agentId = registered.args.agentId.toString();
    updateAgent(agent.key, { erc8004_agent_id: agentId });
    return agentId;
  });
}

/** Asks the verifier, on the ERC-8004 Validation Registry, to attest this work. A failure here never stops the task. */
export async function requestValidation(params: { validator: Hex; agentId: string; requestURI: string; requestHash: Hex }): Promise<Hex | null> {
  try {
    return await runPlatformSepoliaWrite(async (wallet) => {
      const hash = await wallet.writeContract({
        address: config.escrow.validationRegistry(),
        abi: validationRegistryAbi,
        functionName: "validationRequest",
        args: [params.validator, BigInt(params.agentId), params.requestURI, params.requestHash],
      });
      await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
      return hash;
    });
  } catch (err) {
    log.warn("ERC-8004 validation request failed", { error: (err as Error).message });
    return null;
  }
}
