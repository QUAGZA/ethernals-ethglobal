/**
 * Adoption: a person signs in on any server and their agents, found on-chain, come with them.
 * An agent is adopted only if (a) its ledger provider key is this person's, and (b) the Hedera key derived from this
 * server's root secret really controls the agent's account, so a server with a different secret can never fake it.
 * The agent's config and encrypted secrets are then restored from its ENS records.
 */
import { ENS_KEYS } from "@ethernals/shared";
import { accountEvmAddress, parseEcdsaKey } from "./hedera";
import { decryptSecret, deriveAgentKeyHex, encryptSecret, providerKey } from "./crypto";
import { config } from "./config";
import {
  getAgentByEnsName,
  insertAgent,
  insertAgentTool,
  listChainAgents,
  upsertBrain,
  type ChainAgentRow,
  type PersonRow,
} from "./db";
import { readText } from "./ens";
import { log } from "./events";
import { getStats } from "./ledger";
import { randomId } from "./crypto";

interface PublishedConfig {
  modelType?: string;
  model?: string | null;
  systemPrompt?: string;
  tools?: { kind: "mcp" | "http"; name: string; url: string; description?: string; schema?: string | null }[];
}
interface PublishedSecrets {
  config?: PublishedConfig;
  zgApiKey?: string | null;
  toolAuth?: Record<string, string>;
}

async function adoptOne(person: PersonRow, row: ChainAgentRow): Promise<boolean> {
  if (getAgentByEnsName(row.name) || !row.hedera_account) return false;
  const stats = await getStats(row.key as `0x${string}`);
  if (stats.providerKey.toLowerCase() !== providerKey(person.id).toLowerCase()) return false;

  // Does the key derived from our root secret control the agent's account?
  const derived = deriveAgentKeyHex(row.name);
  const evm = `0x${parseEcdsaKey(derived).publicKey.toEvmAddress()}`.toLowerCase();
  if ((await accountEvmAddress(row.hedera_account)) !== evm) return false;

  const erc = (await readText(row.name, ENS_KEYS.erc8004).catch(() => null))?.split(":").pop() ?? null;
  const agent = insertAgent({
    key: row.key,
    ens_name: row.name,
    label: row.label,
    kind: "seller",
    person_id: person.id,
    hedera_account_id: row.hedera_account,
    evm_address: evm,
    enc_private_key: encryptSecret(derived),
    base_price: stats.basePrice.toString(),
    task_type: (["summarize", "translate", "code-fix"] as const).find((t) => t === row.task_type) ?? null,
    description: row.description,
    budget_remaining: "0",
    ledger_registered: 1,
    ens_registered: 1,
    erc8004_agent_id: erc && /^\d+$/.test(erc) ? erc : null,
    arena_role: null,
  });

  // Restore its setup from ENS: public config plus the secrets sealed with the root secret.
  const rawSecrets = await readText(row.name, ENS_KEYS.secrets).catch(() => null);
  let secrets: PublishedSecrets = {};
  try {
    if (rawSecrets) secrets = JSON.parse(decryptSecret(rawSecrets));
  } catch {
    /* sealed with a different root secret: the agent keeps defaults */
  }
  const published: PublishedConfig = secrets.config ?? {};
  upsertBrain({
    agent_key: agent.key,
    api_key_enc: secrets.zgApiKey ? encryptSecret(secrets.zgApiKey) : null,
    key_label: secrets.zgApiKey ? `${secrets.zgApiKey.slice(0, 5)}…${secrets.zgApiKey.slice(-4)}` : null,
    model: published.model ?? row.brain?.split(":").slice(1).join(":") ?? "",
    credit_neuron: config.zeroG.seedCreditNeuron().toString(),
    spent_neuron: "0",
    earned_units: "0",
    credited_from_earnings_neuron: "0",
    last_request_id: null,
    model_type: published.modelType ?? "text",
    system_prompt: published.systemPrompt || null,
  });
  for (const t of published.tools ?? []) {
    const auth = secrets.toolAuth?.[t.name];
    insertAgentTool({
      id: randomId("tool"),
      agent_key: agent.key,
      kind: t.kind,
      name: t.name,
      url: t.url,
      description: t.description ?? "",
      schema_json: t.schema ?? null,
      auth_enc: auth ? encryptSecret(auth) : null,
    });
  }
  log.info(`adopted ${row.name} for @${person.handle}`);
  return true;
}

/** Called after sign-in. Never throws; returns how many agents were adopted. */
export async function adoptAgentsFor(person: PersonRow): Promise<number> {
  let adopted = 0;
  for (const row of listChainAgents()) {
    try {
      if (await adoptOne(person, row)) adopted++;
    } catch (err) {
      log.warn(`could not adopt ${row.name}`, { error: (err as Error).message });
    }
  }
  return adopted;
}
