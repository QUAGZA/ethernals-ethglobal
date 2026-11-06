/**
 * Full lifecycle on Sepolia against a RUNNING verifier (`pnpm verifier:dev`):
 *   mint tUSDC -> approve -> createTask -> specialist accepts + submits patch hash -> verifier grades + settles
 *   -> read balances -> check the receipt against the on-chain commitment.
 * Runs the good patch (expect: specialist paid) and the weak patch (expect: client refunded).
 * Spends a little Sepolia ETH from SEPOLIA_PRIVATE_KEY (the platform wallet acts as the client).
 */
import { createPublicClient, createWalletClient, formatUnits, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { loadConfig } from "../src/config";
import { loadDemo } from "../src/demo";
import { mockUsdcFullAbi, taskEscrowFullAbi } from "../src/generated/artifacts";
import { keccakUtf8 } from "../src/hashing";

const cfg = loadConfig();
const rawKey = process.env.SEPOLIA_PRIVATE_KEY;
const usdcAddr = process.env.MOCK_USDC_ADDRESS as Hex | undefined;
const escrow = cfg.escrowAddress;
if (!rawKey || !usdcAddr || !escrow) throw new Error("Need SEPOLIA_PRIVATE_KEY, MOCK_USDC_ADDRESS and TASK_ESCROW_ADDRESS in .env (run pnpm deploy:escrow).");
const verifierUrl = process.env.VERIFIER_URL ?? "http://127.0.0.1:4100";

const transport = http(cfg.sepoliaRpcUrl);
const pub = createPublicClient({ chain: sepolia, transport });
const clientAcct = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex);
const specialistAcct = privateKeyToAccount(generatePrivateKey());
const clientW = createWalletClient({ chain: sepolia, transport, account: clientAcct });
const specW = createWalletClient({ chain: sepolia, transport, account: specialistAcct });
const tx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const U = (n: number) => BigInt(Math.round(n * 1e6));
const bal = async (a: Hex) => formatUnits((await pub.readContract({ address: usdcAddr, abi: mockUsdcFullAbi, functionName: "balanceOf", args: [a] })) as bigint, 6);

async function send(label: string, hashPromise: Promise<Hex>): Promise<Hex> {
  const hash = await hashPromise;
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${tx(hash)}`);
  return hash;
}

async function vcall<T>(p: string, init?: RequestInit): Promise<T> {
  const res = await fetch(verifierUrl + p, { ...init, headers: { "content-type": "application/json", "x-verifier-token": cfg.token, ...(init?.headers ?? {}) } });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`verifier ${p}: ${body.error ?? res.status}`);
  return body;
}

const health = await vcall<{ mode: string; escrow: string | null; validator: Hex }>("/health");
console.log(`verifier mode=${health.mode} validator=${health.validator} escrow=${health.escrow}`);
if (health.escrow?.toLowerCase() !== escrow.toLowerCase()) throw new Error("The running verifier has a different (or no) TASK_ESCROW_ADDRESS. Restart it after deploy:escrow.");

const demo = loadDemo();
const tests = await vcall<{ testsId: string; testsHash: Hex }>("/tests", { method: "POST", body: JSON.stringify(demo.bundle) });

console.log(`client ${clientAcct.address}\nspecialist ${specialistAcct.address} (fresh key, funded with gas)`);
await send("fund specialist gas", clientW.sendTransaction({ to: specialistAcct.address, value: parseEther("0.004") }));
await send("mint 10 tUSDC to client", clientW.writeContract({ address: usdcAddr, abi: mockUsdcFullAbi, functionName: "mint", args: [clientAcct.address, U(10)] }));
await send("approve escrow", clientW.writeContract({ address: usdcAddr, abi: mockUsdcFullAbi, functionName: "approve", args: [escrow, U(10)] }));

async function runCase(name: "good" | "weak") {
  console.log(`\n=== ${name.toUpperCase()} patch ===`);
  const patch = demo[name];
  const before = { client: await bal(clientAcct.address), specialist: await bal(specialistAcct.address) };
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const spec = { title: "Repair slugify()", repoUrl: "demo://slugify", name };
  const createHash = await send("createTask (2 tUSDC bounty)", clientW.writeContract({
    address: escrow!, abi: taskEscrowFullAbi, functionName: "createTask",
    args: [U(2), deadline, specialistAcct.address, keccakUtf8(JSON.stringify(spec)), tests.testsHash, "demo://slugify"],
  }));
  void createHash;
  const taskId = (await pub.readContract({ address: escrow!, abi: taskEscrowFullAbi, functionName: "taskCount" })) as bigint;
  await send("specialist acceptTask", specW.writeContract({ address: escrow!, abi: taskEscrowFullAbi, functionName: "acceptTask", args: [taskId] }));
  await send("specialist submitResult (patch hash)", specW.writeContract({ address: escrow!, abi: taskEscrowFullAbi, functionName: "submitResult", args: [taskId, keccakUtf8(patch), "patch://local"] }));

  const { jobId } = await vcall<{ jobId: string }>("/verify", {
    method: "POST",
    body: JSON.stringify({ taskId: `e2e-${name}-${taskId}`, chainTaskId: taskId.toString(), repoUrl: "demo://slugify", baseCommit: "0".repeat(40), patch, testsId: tests.testsId, testsHash: tests.testsHash, specialistAgentId: "pixel.eth" }),
  });
  console.log(`  verifier job ${jobId}: running hidden tests...`);
  let job: { status: string; settleTxHash: Hex | null; error: string | null; result: { passed: boolean; testsPassed: number; testsFailed: number; isolation: string } | null } | undefined;
  for (let i = 0; i < 300; i++) {
    try {
      job = await vcall(`/jobs/${jobId}`);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
      continue; // a dropped local connection must not abort a run that is still going
    }
    if (job && ["passed", "failed", "error"].includes(job.status) && (job.settleTxHash || job.error)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!job || job.error) throw new Error(`job failed: ${job?.error}`);
  console.log(`  verdict: ${job.status.toUpperCase()} (${job.result!.testsPassed} pass / ${job.result!.testsFailed} fail, isolation=${job.result!.isolation})`);
  console.log(`  settle: ${tx(job.settleTxHash!)}`);
  const after = { client: await bal(clientAcct.address), specialist: await bal(specialistAcct.address) };
  console.log(`  specialist tUSDC: ${before.specialist} -> ${after.specialist}   client tUSDC: ${before.client} -> ${after.client}`);
  const check = await (await fetch(`${verifierUrl}/receipts/${jobId}/verify`)).json() as { status: string; reasons: string[] };
  console.log(`  receipt vs chain: ${check.status.toUpperCase()} ${check.reasons.join("; ")}`);
  const ok = name === "good" ? job.status === "passed" && after.specialist > before.specialist : job.status === "failed" && after.specialist === before.specialist;
  return ok && check.status === "verified";
}

const results = [await runCase("good"), await runCase("weak")];
console.log(`\n${results.every(Boolean) ? "ALL GOOD: good patch paid, weak patch refunded, receipts verified on-chain." : "SOMETHING FAILED, see above."}`);
process.exit(results.every(Boolean) ? 0 : 1);
