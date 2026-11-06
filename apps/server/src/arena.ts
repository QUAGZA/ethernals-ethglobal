/**
 * The Arena (PRD F8): the same attack against an open ERC-8004 registry and against Ethernals.
 *  - Left: fresh wallets each call the official ERC-8004 giveFeedback(…5 stars…) on Sepolia.
 *  - Right: farm buyer agents owned by ONE person hire our agent through the real x402 flow on Hedera and rate it 5.
 * Preparation (accounts, gas, USDC) happens ahead of time in `pnpm arena:prepare`.
 */
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEventLogs,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  formatScore,
  formatUnits6,
  hashscanTxUrl,
  identityRegistryAbi,
  reputationRegistryAbi,
  sepoliaAddressUrl,
  sepoliaTxUrl,
  type ArenaState,
} from "@ethernals/shared";
import { createFarmAgent } from "./agents";
import { fundFromOperator } from "./hedera";
import { config, normalizeEcdsaKey } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  findPersonByHandle,
  getAgentByLabel,
  getDb,
  insertArenaWallet,
  kvGet,
  kvSet,
  listArenaAgents,
  listArenaWallets,
  markArenaWallet,
  type AgentRow,
} from "./db";
import { sepoliaPublic } from "./ens";
import { emit, log } from "./events";
import { getStats } from "./ledger";
import { hireAsAgent } from "./buyer";

const GIVE_FEEDBACK_GAS = 220_000n;
const FARM_UNITS_EACH = 150_000n; // 0.15 USDC
const ARENA_INPUT =
  "Ethernals arena check: please summarize this short note. Agents can pay each other per request over x402, but open reputation registries are easy to farm with fake reviewers.";

interface OpenState {
  agentId: string | null;
  gasUsed: string;
  txHashes: string[];
  gasPriceWei: string;
}
interface EthernalsState {
  targetLabel: string | null;
  attackerHandle: string | null;
  otherHandle: string | null;
  attacker: "provider" | "other";
}

const running = { open: false, ethernals: false };

function sepoliaWallet(privateKey: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: sepolia,
    transport: http(config.sepolia.rpcUrl(), { timeout: 60_000 }),
  });
}

function platformKey(): Hex {
  return normalizeEcdsaKey(config.sepolia.privateKey());
}

function openState(): OpenState {
  return kvGet<OpenState>("arena.open") ?? { agentId: null, gasUsed: "0", txHashes: [], gasPriceWei: "0" };
}
function ethernalsState(): EthernalsState {
  return kvGet<EthernalsState>("arena.ethernals") ?? { targetLabel: null, attackerHandle: null, otherHandle: null, attacker: "provider" };
}

// ---------------------------------------------------------------- prepare

export interface PrepareOptions {
  attackerHandle: string;
  otherHandle?: string | null;
  targetLabel?: string;
  onStep?: (msg: string) => void;
}

export async function prepareArena(opts: PrepareOptions): Promise<void> {
  const step = opts.onStep ?? ((m: string) => log.info(m));
  const target = getAgentByLabel(opts.targetLabel ?? "summarize");
  if (!target || target.kind !== "seller") {
    throw new Error(`The Arena needs a seller agent called "${opts.targetLabel ?? "summarize"}". Create it on /provider first.`);
  }
  const attacker = findPersonByHandle(opts.attackerHandle);
  if (!attacker) throw new Error(`No person with handle "${opts.attackerHandle}". Sign them up on /signup first.`);
  if (attacker.id !== target.person_id) {
    step(`Note: ${opts.attackerHandle} does not own ${target.ens_name}; the farm will be "a different person".`);
  }

  await prepareOpenSide(step);

  step(`Creating ${config.arena.farmHires} farm agents for ${attacker.handle} (Hedera accounts + 0.15 USDC each)...`);
  const role = attacker.id === target.person_id ? "farm-provider" : "farm-other";
  await createFarm(attacker.handle, role, step);
  if (opts.otherHandle) {
    const other = findPersonByHandle(opts.otherHandle);
    if (!other) throw new Error(`No person with handle "${opts.otherHandle}".`);
    step(`Creating ${config.arena.farmHires} farm agents for ${other.handle} (the "different person" toggle)...`);
    await createFarm(other.handle, "farm-other", step);
  }
  kvSet("arena.ethernals", {
    targetLabel: target.label,
    attackerHandle: attacker.handle,
    otherHandle: opts.otherHandle ?? null,
    attacker: "provider",
  } satisfies EthernalsState);
  step("Arena ready.");
}

async function createFarm(handle: string, role: string, step: (m: string) => void): Promise<void> {
  const person = findPersonByHandle(handle)!;
  const existing = listArenaAgents(role).filter((a) => a.person_id === person.id);
  // Agents used by an earlier run get topped up again.
  for (const agent of existing.filter((a) => BigInt(a.budget_remaining) === 0n)) {
    await fundFromOperator(agent.hedera_account_id, FARM_UNITS_EACH);
    getDb().prepare("UPDATE agents SET budget_remaining = ? WHERE key = ?").run(FARM_UNITS_EACH.toString(), agent.key);
    step(`  topped up ${agent.label}`);
  }
  for (let i = existing.length; i < config.arena.farmHires; i++) {
    await createFarmAgent(person, i + 1, role, FARM_UNITS_EACH);
    step(`  farm agent ${i + 1}/${config.arena.farmHires} ready`);
  }
}

async function prepareOpenSide(step: (m: string) => void): Promise<void> {
  const state = openState();
  const owner = sepoliaWallet(platformKey());
  const gasPrice = await sepoliaPublic.getGasPrice();
  const perWallet = GIVE_FEEDBACK_GAS * gasPrice * 3n;

  if (!state.agentId) {
    step("Registering the arena copy of the agent in the official ERC-8004 Identity Registry (Sepolia)...");
    const registration = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "summarize (Ethernals arena copy)",
      description: "A test agent used to show how cheaply open ERC-8004 reputation can be farmed.",
      services: [{ name: "web", endpoint: config.publicBaseUrl }],
    };
    const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString("base64")}`;
    const hash = await owner.writeContract({
      address: config.erc8004.identity,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [agentURI],
    });
    const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    const [registered] = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: "Registered" });
    if (!registered) throw new Error("ERC-8004 register() did not emit Registered.");
    state.agentId = registered.args.agentId.toString();
    kvSet("arena.open", state);
    step(`  ERC-8004 agentId ${state.agentId} (${sepoliaTxUrl(hash)})`);
  }

  // Two honest-looking 3-star reviews, so both sides start at 3.0.
  let seeds = listArenaWallets("open-seed");
  if (seeds.length === 0) {
    for (let i = 0; i < 2; i++) {
      const key = generatePrivateKey();
      insertArenaWallet(privateKeyToAccount(key).address, encryptSecret(key), "open-seed");
    }
    seeds = listArenaWallets("open-seed");
  }
  const fakes = listArenaWallets("open-fake");
  for (let i = fakes.length; i < config.arena.fakeReviewers; i++) {
    const key = generatePrivateKey();
    insertArenaWallet(privateKeyToAccount(key).address, encryptSecret(key), "open-fake");
  }

  const toFund = [...listArenaWallets("open-seed"), ...listArenaWallets("open-fake")].filter((w) => !w.funded);
  if (toFund.length > 0) {
    const balance = await sepoliaPublic.getBalance({ address: owner.account.address });
    const needed = perWallet * BigInt(toFund.length);
    if (balance < needed) {
      throw new Error(
        `The Sepolia wallet has ${formatEther(balance)} ETH but the Arena needs about ${formatEther(needed)} ETH for ${toFund.length} wallets. Get more Sepolia ETH (SETUP.md, Step 4d) or lower ARENA_FAKE_REVIEWERS.`,
      );
    }
    step(`Funding ${toFund.length} reviewer wallets with gas (${formatEther(perWallet)} ETH each)...`);
    const hashes: Hex[] = [];
    for (const w of toFund) {
      hashes.push(await owner.sendTransaction({ to: w.address as Hex, value: perWallet }));
    }
    for (let i = 0; i < hashes.length; i++) {
      await sepoliaPublic.waitForTransactionReceipt({ hash: hashes[i], timeout: 180_000 });
      markArenaWallet(toFund[i].address, { funded: 1 });
    }
  }
  state.gasPriceWei = gasPrice.toString();
  kvSet("arena.open", state);

  for (const seed of listArenaWallets("open-seed").filter((w) => !w.used)) {
    step("Seeding a 3-star review...");
    await sendFeedback(seed.enc_private_key, BigInt(state.agentId!), 3n);
    markArenaWallet(seed.address, { used: 1 });
  }
}

async function sendFeedback(encKey: string, agentId: bigint, stars: bigint): Promise<{ hash: Hex; gasUsed: bigint }> {
  const wallet = sepoliaWallet(decryptSecret(encKey) as Hex);
  const state = openState();
  const funded = BigInt(state.gasPriceWei || "0") * 3n; // wallets were funded for 3x the prepare-time gas price
  const current = (await sepoliaPublic.getGasPrice()) * 12n / 10n;
  const gasPrice = funded > 0n && current > funded ? funded : current;
  const hash = await wallet.writeContract({
    address: config.erc8004.reputation,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [agentId, stars, 0, "stars", "", "", "", `0x${"0".repeat(64)}`],
    gas: GIVE_FEEDBACK_GAS,
    gasPrice,
  });
  const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("giveFeedback reverted");
  return { hash, gasUsed: receipt.gasUsed };
}

// ---------------------------------------------------------------- run

export function runOpenAttack(): void {
  if (running.open) return;
  const state = openState();
  const wallets = listArenaWallets("open-fake").filter((w) => w.funded && !w.used);
  if (!state.agentId || wallets.length === 0) throw new Error("The open-registry side is not prepared. Run: pnpm arena:prepare -- --attacker <handle>");
  running.open = true;
  void (async () => {
    let gasUsed = BigInt(state.gasUsed || "0");
    const hashes = [...state.txHashes];
    await Promise.all(
      wallets.map(async (w) => {
        try {
          const r = await sendFeedback(w.enc_private_key, BigInt(state.agentId!), 5n);
          markArenaWallet(w.address, { used: 1 });
          gasUsed += r.gasUsed;
          hashes.push(r.hash);
          kvSet("arena.open", { ...openState(), gasUsed: gasUsed.toString(), txHashes: hashes });
          emit("arena.open.feedback", { message: `Fake 5★ review from ${w.address.slice(0, 8)}…`, txUrl: sepoliaTxUrl(r.hash) });
        } catch (err) {
          log.error("fake review failed", err);
        }
      }),
    );
    emit("arena.open.done", { message: `${wallets.length} fake reviews sent to the open registry` });
  })().finally(() => {
    running.open = false;
  });
}

export function runEthernalsAttack(attacker: "provider" | "other" = "provider"): void {
  if (running.ethernals) return;
  const state = ethernalsState();
  const target = state.targetLabel ? getAgentByLabel(state.targetLabel) : undefined;
  const role = attacker === "provider" ? "farm-provider" : "farm-other";
  const farm = listArenaAgents(role).filter((a) => BigInt(a.budget_remaining) >= 1n);
  if (!target || farm.length === 0) {
    throw new Error(
      attacker === "other"
        ? "No 'different person' farm is prepared. Run: pnpm arena:prepare -- --attacker <provider-handle> --other <second-handle>"
        : "The Ethernals side is not prepared. Run: pnpm arena:prepare -- --attacker <provider-handle>",
    );
  }
  kvSet("arena.ethernals", { ...state, attacker });
  kvSet("arena.ethernals.since", new Date().toISOString());
  running.ethernals = true;
  void (async () => {
    let done = 0;
    const queue = [...farm];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let agent = queue.shift(); agent; agent = queue.shift()) {
        try {
          await hireAsAgent({
            buyer: agent,
            targetEnsName: target.ens_name,
            input: ARENA_INPUT,
            consent: { forward: false, subBudget: "0" },
            maxUnits: BigInt(agent.budget_remaining),
            fixedRating: 5,
            arena: true,
          });
          getDb().prepare("UPDATE agents SET budget_remaining = '0' WHERE key = ?").run(agent.key);
        } catch (err) {
          log.error(`farm hire by ${agent.label} failed`, err);
        }
        done++;
        emit("arena.ethernals.progress", { message: `Farm hire ${done}/${farm.length} paid`, done, total: farm.length });
      }
    });
    await Promise.all(workers);
    emit("arena.ethernals.done", { message: `${farm.length} farmed hires sent; watch them get recorded` });
  })().finally(() => {
    running.ethernals = false;
  });
}

// ---------------------------------------------------------------- state

let baseGasCache: { wei: bigint; at: number } | null = null;
async function baseMainnetGasPrice(): Promise<bigint> {
  if (baseGasCache && Date.now() - baseGasCache.at < 60_000) return baseGasCache.wei;
  try {
    const client = createPublicClient({ transport: http(config.arena.baseMainnetRpcUrl, { timeout: 8000 }) });
    const wei = await client.getGasPrice();
    baseGasCache = { wei, at: Date.now() };
    return wei;
  } catch {
    return baseGasCache?.wei ?? 10_000_000n; // 0.01 gwei fallback
  }
}

export async function getArenaState(): Promise<ArenaState> {
  const open = openState();
  const eth = ethernalsState();
  const fakeWallets = listArenaWallets("open-fake");

  let average = "—";
  let feedbackCount = 0;
  let reviewers = 0;
  if (open.agentId) {
    try {
      const agentId = BigInt(open.agentId);
      const clients = await sepoliaPublic.readContract({
        address: config.erc8004.reputation,
        abi: reputationRegistryAbi,
        functionName: "getClients",
        args: [agentId],
      });
      reviewers = clients.length;
      if (clients.length > 0) {
        const all = await sepoliaPublic.readContract({
          address: config.erc8004.reputation,
          abi: reputationRegistryAbi,
          functionName: "readAllFeedback",
          args: [agentId, [...clients], "", "", false],
        });
        const values = all[2];
        const decimals = all[3];
        feedbackCount = values.length;
        const sum = values.reduce((s, v, i) => s + Number(v) / 10 ** Number(decimals[i]), 0);
        average = feedbackCount ? (sum / feedbackCount).toFixed(2) : "—";
      }
    } catch (err) {
      log.warn("could not read ERC-8004 state", { error: (err as Error).message });
    }
  }
  const gasUsed = BigInt(open.gasUsed || "0");
  const costUsd = (Number(gasUsed * (await baseMainnetGasPrice())) / 1e18) * config.arena.ethUsdPrice;

  // Right side
  const target = eth.targetLabel ? getAgentByLabel(eth.targetLabel) : undefined;
  const role = eth.attacker === "other" ? "farm-other" : "farm-provider";
  const farmKeys = new Set(listArenaAgents(role).map((a: AgentRow) => a.key));
  const since = kvGet<string>("arena.ethernals.since") ?? "1970-01-01";
  const rows = target
    ? (getDb()
        .prepare("SELECT * FROM hires WHERE agent_key = ? AND arena = 1 AND created_at >= ? ORDER BY created_at")
        .all(target.key, since) as { buyer_agent_key: string; payment_tx_id: string | null; counted: number | null; paid_amount: string | null; quoted_price: string }[])
    : [];
  const farmRows = rows.filter((r) => farmKeys.has(r.buyer_agent_key));
  let score = "3.00";
  let price = target ? formatUnits6(BigInt(target.base_price)) : "—";
  if (target && config.hedera.ledgerAddressOrNull()) {
    try {
      const s = await getStats(target.key as Hex);
      score = formatScore(s.scoreX1e6);
      price = formatUnits6(s.price);
    } catch {
      /* keep defaults */
    }
  }
  const spent = farmRows.reduce((sum, r) => sum + BigInt(r.paid_amount ?? (r.payment_tx_id ? r.quoted_price : "0")), 0n);

  return {
    open: {
      ready: Boolean(open.agentId) && fakeWallets.some((w) => w.funded && !w.used),
      running: running.open,
      agentId: open.agentId,
      registry: config.erc8004.reputation,
      reviewers,
      feedbackCount,
      average,
      gasUsed: gasUsed.toString(),
      costUsd: costUsd.toFixed(4),
      txUrls: open.txHashes.slice(-30).map(sepoliaTxUrl),
      agentUrl: open.agentId ? sepoliaAddressUrl(config.erc8004.identity) : null,
      fakeWallets: fakeWallets.filter((w) => w.funded && !w.used).length,
    },
    ethernals: {
      ready: Boolean(target) && listArenaAgents("farm-provider").some((a) => BigInt(a.budget_remaining) > 0n),
      running: running.ethernals,
      agentEnsName: target?.ens_name ?? null,
      attackerHandle: eth.attacker === "other" ? eth.otherHandle : eth.attackerHandle,
      attackerIsProvider: eth.attacker !== "other",
      hires: farmRows.length,
      paid: farmRows.filter((r) => r.payment_tx_id).length,
      counted: farmRows.filter((r) => r.counted === 1).length,
      notCounted: farmRows.filter((r) => r.counted === 0).length,
      spentUsdc: formatUnits6(spent),
      score,
      price,
      paymentUrls: farmRows.filter((r) => r.payment_tx_id).slice(-30).map((r) => hashscanTxUrl(r.payment_tx_id!)),
      farmSize: listArenaAgents(role).filter((a) => BigInt(a.budget_remaining) > 0n).length,
    },
  };
}
