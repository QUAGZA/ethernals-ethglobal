/**
 * Creating agents: a Hedera account (+ USDC association), HireLedger registration (sellers), an ENS subname
 * with live records, and — for buyer agents — a starting USDC balance and budget.
 */
import { namehash } from "viem/ens";
import { assertValidLabel, DEFAULT_MEDIA_MODELS, formatUnits6, modelTypeFor, parseUnits6, type CreateAgentRequest, type TaskType } from "@ethernals/shared";
import { config } from "./config";
import { spinUpBrain } from "./brain";
import { deriveAgentKeyHex, encryptSecret, personHash, providerKey } from "./crypto";
import { getAgentByLabel, getAgentByEnsName, insertAgent, listAgentsOfPerson, updateAgent, type AgentRow, type PersonRow } from "./db";
import { agentEnsName, publishAgent } from "./ens";
import { badRequest, conflict } from "./errors";
import { ensureSepoliaGas, registerErc8004 } from "./escrow";
import { emit, log } from "./events";
import { createAgentAccount, fundFromOperator } from "./hedera";
import { registerAgentOnLedger } from "./ledger";

export function providerKeyShort(personId: string): string {
  return providerKey(personId).slice(0, 12);
}

interface CreateOptions {
  person: PersonRow;
  label: string;
  kind: "seller" | "buyer";
  taskType: TaskType | null;
  basePriceUnits: bigint;
  description: string;
  startingUnits?: bigint;
  publishEns?: boolean;
  arenaRole?: string | null;
  strategy?: AgentRow["strategy"];
  zgApiKey?: string;
  modelType?: "text" | "image" | "decision" | "embedding" | "video";
  model?: string;
  systemPrompt?: string;
  onStep?: (msg: string) => void;
}

/** Live spin-up steps for the /provider checklist. */
function born(ensName: string, step: string, message: string): void {
  emit("agent.born", { agentEnsName: ensName, step, message });
}

/** Sepolia gas and an ERC-8004 identity. A failure leaves a working agent, and the checklist shows it. */
async function spinUpOnSepolia(agent: AgentRow): Promise<void> {
  try {
    await ensureSepoliaGas(agent.evm_address as `0x${string}`);
    born(agent.ens_name, "gas", "Sepolia gas ✓");
    const agentId = await registerErc8004(agent);
    born(agent.ens_name, "erc8004", `ERC-8004 ✓ agent ${agentId}`);
  } catch (err) {
    log.error(`Sepolia spin-up failed for ${agent.ens_name}`, err);
    born(agent.ens_name, "erc8004", `ERC-8004 ✖ ${(err as Error).message.split("\n")[0]}`);
  }
}

async function createAgent(opts: CreateOptions): Promise<AgentRow> {
  assertValidLabel(opts.label);
  if (getAgentByLabel(opts.label)) throw conflict(`An agent called "${opts.label}" already exists.`, "Pick another name.");
  const ensName = agentEnsName(opts.label);
  if (getAgentByEnsName(ensName)) throw conflict(`${ensName} is already taken.`);
  const key = namehash(ensName);
  const step = opts.onStep ?? (() => {});

  step(`Creating a Hedera account for ${ensName}...`);
  const account = await createAgentAccount(opts.kind === "seller" ? 2 : 1, deriveAgentKeyHex(ensName));

  let agent = insertAgent({
    key,
    ens_name: ensName,
    label: opts.label,
    kind: opts.kind,
    person_id: opts.person.id,
    hedera_account_id: account.accountId,
    evm_address: account.evmAddress,
    enc_private_key: encryptSecret(account.privateKeyHex),
    base_price: opts.basePriceUnits.toString(),
    task_type: opts.taskType,
    description: opts.description,
    budget_remaining: (opts.startingUnits ?? 0n).toString(),
    ledger_registered: 0,
    ens_registered: 0,
    erc8004_agent_id: null,
    arena_role: opts.arenaRole ?? null,
    strategy: opts.strategy ?? "careful",
  });
  if (opts.kind === "seller") born(ensName, "hedera", "Hedera account ✓");

  if (opts.kind === "seller") {
    step("Registering on the HireLedger (Hedera)...");
    await registerAgentOnLedger({
      agentKey: key,
      providerKey: providerKey(opts.person.id),
      providerPersonHash: personHash(opts.person.id, key),
      basePrice: opts.basePriceUnits,
    });
    updateAgent(key, { ledger_registered: 1 });
    born(ensName, "ledger", "HireLedger ✓");
    step("Spinning up its brain on 0G Compute...");
    await spinUpBrain(agent, { ownKey: opts.zgApiKey, modelType: opts.modelType, model: opts.model, systemPrompt: opts.systemPrompt });
    if (opts.taskType === "code-fix") await spinUpOnSepolia(agent);
    agent = getAgentByLabel(opts.label)!;
  }

  if (opts.startingUnits && opts.startingUnits > 0n) {
    step(`Funding with ${formatUnits6(opts.startingUnits)} ${config.hedera.paymentAsset}...`);
    try {
      await fundFromOperator(account.accountId, opts.startingUnits);
    } catch (err) {
      log.error(`could not fund ${ensName}`, err);
      throw badRequest(
        `Created ${ensName}, but funding it failed: ${(err as Error).message}`,
        "The operator account may be out of test USDC. Get more at faucet.circle.com (Hedera Testnet), then run pnpm check-setup.",
      );
    }
  }

  if (opts.publishEns !== false) {
    step(`Publishing ${ensName} in ENS (Sepolia)...`);
    try {
      await publishAgent(agent, providerKeyShort(opts.person.id));
      born(ensName, "ens", "ENS ✓");
    } catch (err) {
      // The agent works without ENS records (local discovery); `pnpm ens:sync` can publish it later.
      log.error(`ENS publish failed for ${ensName}`, err);
      emit("info", { agentEnsName: ensName, message: `ENS publish failed: ${(err as Error).message}. Run pnpm ens:sync later.` });
      born(ensName, "ens", "ENS ✖ run pnpm ens:sync later");
    }
  }

  agent = getAgentByLabel(opts.label)!;
  emit("agent.created", { agentEnsName: ensName, message: `${ensName} created (${opts.kind})` });
  return agent;
}

const DEFAULT_DESCRIPTIONS: Record<CreateAgentRequest["taskType"], string> = {
  "image-gen": "Generates an image from a text prompt.",
  "video-gen": "Generates a short video from a text prompt.",
  summarize: "Summarizes text in up to 5 bullet points.",
  translate: "Translates text into Hindi or Marathi.",
  "code-fix": "Fixes bugs in Python repositories. Paid only when hidden tests pass.",
};

export async function createSellerAgent(
  person: PersonRow,
  req: CreateAgentRequest,
  onStep?: (m: string) => void,
  strategy: AgentRow["strategy"] = "careful",
): Promise<AgentRow> {
  let basePrice: bigint;
  try {
    basePrice = parseUnits6(req.basePrice);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  if (basePrice <= 0n) throw badRequest("Base price must be more than 0.");
  const description = req.description?.trim() || DEFAULT_DESCRIPTIONS[req.taskType];
  // The task type decides the model family, so an agent can't be sold as one thing and think on another.
  const modelType = modelTypeFor(req.taskType);
  const model = req.model?.trim() || (modelType === "text" ? undefined : DEFAULT_MEDIA_MODELS[modelType]);
  return createAgent({
    person,
    label: req.label.trim().toLowerCase(),
    kind: "seller",
    taskType: req.taskType,
    basePriceUnits: basePrice,
    description,
    startingUnits: parseUnits6(config.hedera.sellerStartingUsdc),
    strategy,
    zgApiKey: req.zgApiKey?.trim() || undefined,
    modelType,
    model,
    systemPrompt: req.systemPrompt?.trim() || undefined,
    onStep,
  });
}

/** Every person gets one personal buyer agent `<handle>-buyer.<parent>` with a starting balance. */
export async function ensureBuyerAgent(person: PersonRow, onStep?: (m: string) => void): Promise<AgentRow> {
  const existing = listAgentsOfPerson(person.id).find((a) => a.kind === "buyer" && !a.arena_role);
  if (existing) return existing;
  const starting = parseUnits6(config.hedera.buyerStartingUsdc);
  return createAgent({
    person,
    label: `${person.handle}-buyer`,
    kind: "buyer",
    taskType: null,
    basePriceUnits: 1n,
    description: `Personal buyer agent of ${person.handle}`,
    startingUnits: starting,
    onStep,
  });
}

/** Arena farm agents: buyer agents owned by the attacker, funded, no ENS records (saves Sepolia gas). */
export async function createFarmAgent(person: PersonRow, index: number, role: string, units: bigint): Promise<AgentRow> {
  return createAgent({
    person,
    label: `${person.handle}-farm-${index}`,
    kind: "buyer",
    taskType: null,
    basePriceUnits: 1n,
    description: `Arena farm agent ${index} of ${person.handle}`,
    startingUnits: units,
    publishEns: false,
    arenaRole: role,
  });
}
