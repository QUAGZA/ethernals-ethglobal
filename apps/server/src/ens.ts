/**
 * ENSv2 on Sepolia.
 * Agent subnames are records on the parent name's Permissioned Resolver (no subregistry or token needed):
 * the Universal Resolver finds the parent's resolver and passes it the full name `label.parent.eth`.
 * All text records for a name are written in ONE multicall transaction (PRD ENS-3).
 * Reads use viem's getEnsText (Universal Resolver), exactly like the browser and any other client.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, normalize, packetToBytes } from "viem/ens";
import {
  ENS_KEYS,
  formatScore,
  formatUnits6,
  sepoliaTxUrl,
  type EnsKey,
} from "@ethernals/shared";
import { config, normalizeEcdsaKey, writeEnvValue } from "./config";
import { countSpecialistTasks, getAgent, getBrain, listAgentTools, updateAgent, updateHire, type AgentRow } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { emit, log } from "./events";
import { getStats } from "./ledger";
import { SerialQueue } from "./queue";

/** ENSv2 Sepolia deployment (2026-10-01 set, as shipped in ENSjs 5.2.12). Override via env if ENS redeploys. */
export const ENS_V2_SEPOLIA = {
  verifiableFactory: (process.env.ENS_VERIFIABLE_FACTORY || "0xda70306c98e97ece36f997a21368e53298572991") as Hex,
  permissionedResolverImpl: (process.env.ENS_PERMISSIONED_RESOLVER_IMPL || "0x115eb53f0c60696633855f90b138178fb40b2b2c") as Hex,
  ethRegistry: (process.env.ENS_ETH_REGISTRY || "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4") as Hex,
};

const ALL_ROLES = BigInt(`0x${"1".repeat(64)}`);

const resolverAbi = parseAbi([
  "function setText(bytes name, string key, string value)",
  "function multicall(bytes[] data) returns (bytes[])",
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
]);
const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
const ethRegistryAbi = parseAbi(["function setResolver(uint256 anyId, address resolver)"]);

function readRpc(): string {
  try {
    return config.sepolia.rpcUrl();
  } catch {
    return config.sepolia.publicRpcUrl;
  }
}

export const sepoliaPublic = createPublicClient({ chain: sepolia, transport: http(readRpc(), { timeout: 30_000 }) });

function sepoliaWallet() {
  const account = privateKeyToAccount(normalizeEcdsaKey(config.sepolia.privateKey()));
  return createWalletClient({ account, chain: sepolia, transport: http(config.sepolia.rpcUrl(), { timeout: 60_000 }) });
}

export function platformSepoliaAddress(): Hex {
  return privateKeyToAccount(normalizeEcdsaKey(config.sepolia.privateKey())).address;
}

const sepoliaWrites = new SerialQueue();

/** Runs a transaction from the platform wallet in the shared queue, so nonces never collide. */
export function runPlatformSepoliaWrite<T>(task: (wallet: ReturnType<typeof sepoliaWallet>) => Promise<T>): Promise<T> {
  return sepoliaWrites.run(() => task(sepoliaWallet()));
}

export function agentEnsName(label: string): string {
  return normalize(`${label}.${config.ens.parent()}`);
}

function dnsEncode(name: string): Hex {
  return toHex(packetToBytes(normalize(name)));
}

// ---------------- reads ----------------

export interface AgentRecords {
  endpoint: string | null;
  price: string | null;
  score: string | null;
  votes: string | null;
  raw: Partial<Record<EnsKey, string>>;
}

export async function readText(name: string, key: string): Promise<string | null> {
  return sepoliaPublic.getEnsText({
    name: normalize(name),
    key,
    ...(config.ens.universalResolver ? { universalResolverAddress: config.ens.universalResolver } : {}),
  });
}

export async function readAgentRecords(name: string): Promise<AgentRecords> {
  const keys = [ENS_KEYS.endpoint, ENS_KEYS.price, ENS_KEYS.score, ENS_KEYS.votes] as const;
  const values = await Promise.all(keys.map((k) => readText(name, k).catch(() => null)));
  const raw: Partial<Record<EnsKey, string>> = {};
  keys.forEach((k, i) => {
    if (values[i]) raw[k] = values[i]!;
  });
  return { endpoint: values[0], price: values[1], score: values[2], votes: values[3], raw };
}

export async function getParentResolver(): Promise<Hex | null> {
  return sepoliaPublic.getEnsResolver({ name: normalize(config.ens.parent()) }).catch(() => null);
}

// ---------------- setup (pnpm ens:setup) ----------------

/** Deploys a Permissioned Resolver owned by the platform wallet (all roles) and points the parent name at it. */
export async function setupParentResolver(onStep: (msg: string) => void = () => {}): Promise<Hex> {
  const wallet = sepoliaWallet();
  const parent = config.ens.parent();
  const parentLabel = parent.split(".")[0];
  if (!parent.endsWith(".eth") || parent.split(".").length !== 2) {
    throw new Error(`ENS_PARENT_NAME must be a second-level .eth name like "ethernals-team.eth" (got "${parent}").`);
  }

  let resolver = (process.env.ENS_RESOLVER_ADDRESS || "") as Hex | "";
  if (!resolver) {
    onStep("Deploying a Permissioned Resolver for your ENS name...");
    const salt = BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
          [keccak256(stringToHex("OwnedResolver")), wallet.account.address, BigInt(Date.now())],
        ),
      ),
    );
    const init = encodeFunctionData({
      abi: resolverAbi,
      functionName: "initialize",
      args: [[{ account: wallet.account.address, roleBitmap: ALL_ROLES }], []],
    });
    const hash = await wallet.writeContract({
      address: ENS_V2_SEPOLIA.verifiableFactory,
      abi: factoryAbi,
      functionName: "deployProxy",
      args: [ENS_V2_SEPOLIA.permissionedResolverImpl, salt, init],
    });
    const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    const [deployed] = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "ProxyDeployed" });
    if (!deployed) throw new Error("Resolver deployment did not emit ProxyDeployed.");
    resolver = deployed.args.proxyAddress;
    writeEnvValue("ENS_RESOLVER_ADDRESS", resolver);
    onStep(`Resolver deployed at ${resolver} (${sepoliaTxUrl(hash)})`);
  }

  const current = await getParentResolver();
  if (current?.toLowerCase() !== resolver.toLowerCase()) {
    onStep(`Pointing ${parent} at the resolver...`);
    try {
      const hash = await wallet.writeContract({
        address: ENS_V2_SEPOLIA.ethRegistry,
        abi: ethRegistryAbi,
        functionName: "setResolver",
        args: [BigInt(labelhash(parentLabel)), resolver],
      });
      await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
      onStep(`Resolver set (${sepoliaTxUrl(hash)})`);
    } catch (err) {
      throw new Error(
        `Could not set the resolver for ${parent}. Make sure SEPOLIA_PRIVATE_KEY is the wallet that owns ${parent} on Sepolia ENS (v2). ${(err as Error).message.split("\n")[0]}`,
      );
    }
  }
  return resolver as Hex;
}

function resolverAddress(): Hex {
  const value = process.env.ENS_RESOLVER_ADDRESS;
  if (!value) throw new Error("ENS_RESOLVER_ADDRESS is not set. Run: pnpm ens:setup");
  return value as Hex;
}

// ---------------- writes ----------------

/** Writes several text records for one name in a single multicall transaction. */
export async function setRecords(name: string, records: Record<string, string>): Promise<Hex> {
  const dnsName = dnsEncode(name);
  const calls = Object.entries(records).map(([key, value]) =>
    encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName, key, value] }),
  );
  return sepoliaWrites.run(async () => {
    const hash = await sepoliaWallet().writeContract({
      address: resolverAddress(),
      abi: resolverAbi,
      functionName: "multicall",
      args: [calls],
    });
    const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`ENS write for ${name} reverted.`);
    return hash;
  });
}

export function initialRecords(agent: AgentRow, providerKeyShort: string): Record<string, string> {
  const base = formatUnits6(BigInt(agent.base_price));
  const records: Record<string, string> = {
    [ENS_KEYS.description]: agent.description,
    [ENS_KEYS.label]: agent.label,
    [ENS_KEYS.hedera]: agent.hedera_account_id,
    [ENS_KEYS.provider]: providerKeyShort,
    [ENS_KEYS.updated]: new Date().toISOString(),
  };
  if (agent.kind === "seller") {
    Object.assign(records, {
      [ENS_KEYS.endpoint]: `${config.publicBaseUrl}/a/${agent.label}/task`,
      [ENS_KEYS.context]: agentContext(agent),
      [ENS_KEYS.basePrice]: base,
      [ENS_KEYS.price]: base,
      [ENS_KEYS.score]: "3.00",
      [ENS_KEYS.votes]: "0",
      [ENS_KEYS.hiresCounted]: "0",
      [ENS_KEYS.hiresTotal]: "0",
      [ENS_KEYS.ledger]: `hedera:testnet:${config.hedera.ledgerAddressOrNull() ?? "not-deployed"}`,
    });
    const brain = getBrain(agent.key);
    if (brain) {
      records[ENS_KEYS.brain] = `0g-router:${brain.model}`;
      records[ENS_KEYS.earned] = "0.00";
    }
    Object.assign(records, configRecords(agent));
    if (agent.task_type === "code-fix") {
      Object.assign(records, {
        [ENS_KEYS.capabilities]: "code-fix:python",
        [ENS_KEYS.validation]: "hidden-tests:docker",
        [ENS_KEYS.tasksPassed]: "0",
        [ENS_KEYS.tasksFailed]: "0",
      });
      if (agent.erc8004_agent_id) {
        records[ENS_KEYS.erc8004] = `eip155:11155111:${config.erc8004.identity}:${agent.erc8004_agent_id}`;
      }
    }
  }
  return records;
}

/**
 * The agent's setup as ENS records, so it survives any one server. Nothing readable is published: the model, system
 * prompt, tools, API key and tool auth are all sealed in ONE blob with the platform root secret (KEYSTORE_SECRET), so
 * only the creator's servers can read them. The public `ethernals.config` record is cleared.
 */
export function configRecords(agent: AgentRow): Record<string, string> {
  const brain = getBrain(agent.key);
  const tools = listAgentTools(agent.key);
  const toolAuth: Record<string, string> = {};
  for (const t of tools) if (t.auth_enc) toolAuth[t.name] = decryptSecret(t.auth_enc);
  const sealed = {
    v: 2,
    config: {
      modelType: brain?.model_type ?? "text",
      model: brain?.model ?? null,
      systemPrompt: brain?.system_prompt ?? "",
      tools: tools.map((t) => ({ kind: t.kind, name: t.name, url: t.url, description: t.description, schema: t.schema_json })),
    },
    zgApiKey: brain?.api_key_enc ? decryptSecret(brain.api_key_enc) : null,
    toolAuth,
  };
  return {
    [ENS_KEYS.config]: "",
    [ENS_KEYS.secrets]: encryptSecret(JSON.stringify(sealed)),
  };
}

const configTimers = new Map<string, NodeJS.Timeout>();

/** After the provider changes settings or tools: republish the config (debounced, one transaction). */
export function queueConfigPublish(agent: AgentRow, delayMs = 4_000): void {
  const existing = configTimers.get(agent.key);
  if (existing) clearTimeout(existing);
  configTimers.set(
    agent.key,
    setTimeout(() => {
      configTimers.delete(agent.key);
      void setRecords(agent.ens_name, { ...configRecords(agent), [ENS_KEYS.updated]: new Date().toISOString() })
        .then((hash) => emit("ens.updated", { agentEnsName: agent.ens_name, message: `${agent.ens_name} config published in ENS`, ensUrl: sepoliaTxUrl(hash) }))
        .catch((err) => log.error(`ENS config publish failed for ${agent.ens_name}`, err));
    }, delayMs),
  );
}

/** Points the agent's ENS endpoint at this server ("host it here"). */
export async function publishEndpoint(agent: AgentRow): Promise<Hex> {
  return setRecords(agent.ens_name, {
    [ENS_KEYS.endpoint]: `${config.publicBaseUrl}/a/${agent.label}/task`,
    [ENS_KEYS.updated]: new Date().toISOString(),
  });
}

function agentContext(agent: AgentRow): string {
  if (agent.task_type === "code-fix") return "code-fix · input: a public Python repo and an issue · output: a patch checked by hidden tests";
  if (agent.task_type === "image-gen") return "image-gen · input: a text prompt · output: an image";
  if (agent.task_type === "video-gen") return "video-gen · input: a text prompt · output: a video job";
  if (agent.task_type === "translate") return "translate · input: text ≤ 8k chars · output: translated text";
  return "summarize · input: text ≤ 8k chars · output: up to 5 bullets";
}

/** Records that change when a task settles or an agent earns; written with the score so one settlement is one transaction. */
export function earningsRecords(seller: AgentRow): Record<string, string> {
  const records: Record<string, string> = {};
  const brain = getBrain(seller.key);
  if (brain) records[ENS_KEYS.earned] = formatUnits6(BigInt(brain.earned_units));
  if (seller.task_type === "code-fix") {
    const tasks = countSpecialistTasks(seller.key);
    records[ENS_KEYS.tasksPassed] = String(tasks.passed);
    records[ENS_KEYS.tasksFailed] = String(tasks.failed);
  }
  return records;
}

/** Issues the agent's subname by writing its initial records (records-only subname on the parent's resolver). */
export async function publishAgent(agent: AgentRow, providerKeyShort: string): Promise<Hex> {
  const hash = await setRecords(agent.ens_name, initialRecords(agent, providerKeyShort));
  updateAgent(agent.key, { ens_registered: 1 });
  emit("ens.updated", { agentEnsName: agent.ens_name, message: `${agent.ens_name} published in ENS`, ensUrl: sepoliaTxUrl(hash) });
  return hash;
}

/** After a counted hire: write score, price, votes and counted hires in one transaction. */
export function queueReputationUpdate(seller: AgentRow, hireId: string): void {
  void (async () => {
    const stats = await getStats(seller.key as Hex);
    const hash = await setRecords(seller.ens_name, {
      [ENS_KEYS.score]: formatScore(stats.scoreX1e6),
      [ENS_KEYS.price]: formatUnits6(stats.price),
      [ENS_KEYS.votes]: String(stats.votes),
      [ENS_KEYS.hiresCounted]: String(stats.hiresCounted),
      [ENS_KEYS.hiresTotal]: String(stats.hiresTotal),
      ...earningsRecords(seller),
      [ENS_KEYS.updated]: new Date().toISOString(),
    });
    updateHire(hireId, { ens_tx_hash: hash });
    emit("ens.updated", {
      hireId,
      agentEnsName: seller.ens_name,
      score: formatScore(stats.scoreX1e6),
      price: formatUnits6(stats.price),
      ensUrl: sepoliaTxUrl(hash),
      message: `ENS updated: ${seller.ens_name} score ${formatScore(stats.scoreX1e6)}, price ${formatUnits6(stats.price)}`,
    });
  })().catch((err) => log.error(`ENS reputation update failed for ${seller.ens_name}`, err));
}

const earningsTimers = new Map<string, NodeJS.Timeout>();

/** Earnings and task counts outside a counted hire. Debounced like totals, so a burst of hires is one write. */
export function queueEarningsUpdate(seller: AgentRow, delayMs = 30_000): void {
  if (earningsTimers.has(seller.key)) return;
  earningsTimers.set(
    seller.key,
    setTimeout(() => {
      earningsTimers.delete(seller.key);
      void (async () => {
        const records = earningsRecords(seller);
        if (Object.keys(records).length === 0) return;
        await setRecords(seller.ens_name, { ...records, [ENS_KEYS.updated]: new Date().toISOString() });
      })().catch((err) => log.error(`ENS earnings update failed for ${seller.ens_name}`, err));
    }, delayMs),
  );
}

const totalsTimers = new Map<string, NodeJS.Timeout>();

/** Totals that include uncounted hires are debounced to one write per 30 s per agent (PRD ENS-3). */
export function queueTotalsUpdate(seller: AgentRow): void {
  if (totalsTimers.has(seller.key)) return;
  totalsTimers.set(
    seller.key,
    setTimeout(() => {
      totalsTimers.delete(seller.key);
      void (async () => {
        const fresh = getAgent(seller.key);
        if (!fresh) return;
        const stats = await getStats(seller.key as Hex);
        await setRecords(seller.ens_name, {
          [ENS_KEYS.hiresTotal]: String(stats.hiresTotal),
          [ENS_KEYS.updated]: new Date().toISOString(),
        });
      })().catch((err) => log.error(`ENS totals update failed for ${seller.ens_name}`, err));
    }, 30_000),
  );
}

/** Rewrites every seller's endpoint record to the current PUBLIC_BASE_URL (pnpm ens:sync). */
export async function syncEndpoints(agents: AgentRow[], onStep: (msg: string) => void = () => {}): Promise<void> {
  for (const agent of agents.filter((a) => a.kind === "seller")) {
    const hash = await setRecords(agent.ens_name, {
      [ENS_KEYS.endpoint]: `${config.publicBaseUrl}/a/${agent.label}/task`,
      [ENS_KEYS.label]: agent.label,
      [ENS_KEYS.hedera]: agent.hedera_account_id,
      ...(agent.kind === "seller" ? configRecords(agent) : {}),
      [ENS_KEYS.ledger]: `hedera:testnet:${config.hedera.ledgerAddressOrNull() ?? "not-deployed"}`,
      [ENS_KEYS.updated]: new Date().toISOString(),
    });
    onStep(`${agent.ens_name} → ${config.publicBaseUrl}/a/${agent.label}/task (${sepoliaTxUrl(hash)})`);
  }
}
