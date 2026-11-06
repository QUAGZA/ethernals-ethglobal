/** Converts database rows + ledger state into the API types in @ethernals/shared. */
import type { Hex } from "viem";
import {
  ensAppUrl,
  formatScore,
  formatUnits6,
  hashscanAccountUrl,
  hashscanEvmTxUrl,
  hashscanTxUrl,
  priceOf,
  scoreX1e6,
  sepoliaTxUrl,
  type AgentDetail,
  type AgentSummary,
  type HireStatus,
  type HireView,
  type PersonPublic,
  type Reason,
} from "@ethernals/shared";
import { providerKeyShort } from "./agents";
import { config } from "./config";
import { parseTools } from "./custom-agent";
import { getAgent, getAgentBrain, getPerson, listAgentsOfPerson, listHiresForAgent, type AgentRow, type HireRow, type PersonRow } from "./db";
import { getStats, type LedgerStats } from "./ledger";

const statsCache = new Map<string, { stats: LedgerStats; at: number }>();

async function stats(agent: AgentRow): Promise<LedgerStats | null> {
  if (agent.kind !== "seller" || !agent.ledger_registered || !config.hedera.ledgerAddressOrNull()) return null;
  const cached = statsCache.get(agent.key);
  if (cached && Date.now() - cached.at < 3000) return cached.stats;
  try {
    const s = await getStats(agent.key as Hex);
    statsCache.set(agent.key, { stats: s, at: Date.now() });
    return s;
  } catch {
    return cached?.stats ?? null;
  }
}

export function invalidateStats(agentKey: string): void {
  statsCache.delete(agentKey);
}

export function personView(p: PersonRow): PersonPublic {
  return {
    id: p.id,
    handle: p.handle,
    mode: p.mode,
    providerKeyShort: providerKeyShort(p.id),
    credentialExpired: Boolean(p.credential_expires_at && new Date(p.credential_expires_at).getTime() <= Date.now()),
  };
}

export async function agentView(agent: AgentRow): Promise<AgentSummary> {
  const s = await stats(agent);
  const base = BigInt(agent.base_price);
  const owner = getPerson(agent.person_id);
  return {
    key: agent.key,
    ensName: agent.ens_name,
    label: agent.label,
    kind: agent.kind,
    taskType: agent.task_type,
    description: agent.description,
    brain: (() => {
      const b = agent.task_type === "custom" ? getAgentBrain(agent.key) : undefined;
      return b ? { provider: b.provider, model: b.model, tools: parseTools(b.tools_json), specialization: b.system_prompt } : null;
    })(),
    ownerHandle: owner?.handle ?? "?",
    providerKeyShort: providerKeyShort(agent.person_id),
    hederaAccountId: agent.hedera_account_id,
    evmAddress: agent.evm_address,
    endpoint: agent.kind === "seller" ? `${config.publicBaseUrl}/a/${agent.label}/task` : null,
    basePrice: formatUnits6(base),
    price: formatUnits6(s ? s.price : agent.kind === "seller" ? priceOf(base, 0, 0) : 0n),
    score: formatScore(s ? s.scoreX1e6 : scoreX1e6(0, 0)),
    votes: s?.votes ?? 0,
    hiresTotal: s?.hiresTotal ?? 0,
    hiresCounted: s?.hiresCounted ?? 0,
    createdAt: agent.created_at,
  };
}

export function hireView(h: HireRow): HireView {
  const seller = getAgent(h.agent_key);
  const buyer = getAgent(h.buyer_agent_key);
  const buyerPerson = buyer ? getPerson(buyer.person_id) : undefined;
  return {
    id: h.id,
    agentEnsName: seller?.ens_name ?? "?",
    buyerAgentEnsName: buyer?.ens_name ?? "?",
    buyerHandle: buyerPerson?.handle ?? "?",
    quotedPrice: formatUnits6(BigInt(h.quoted_price)),
    paidAmount: h.paid_amount ? formatUnits6(BigInt(h.paid_amount)) : null,
    paymentTxId: h.payment_tx_id,
    paymentUrl: h.payment_tx_id ? hashscanTxUrl(h.payment_tx_id) : null,
    rating: h.rating,
    status: h.status as HireStatus,
    reason: (h.reason as Reason | null) ?? null,
    counted: h.counted === null ? null : h.counted === 1,
    ledgerTxHash: h.ledger_tx_hash,
    ledgerUrl: h.ledger_tx_hash ? hashscanEvmTxUrl(h.ledger_tx_hash) : null,
    ensTxHash: h.ens_tx_hash,
    ensUrl: h.ens_tx_hash ? sepoliaTxUrl(h.ens_tx_hash) : null,
    parentHireId: h.parent_hire_id,
    createdAt: h.created_at,
  };
}

export async function agentDetail(agent: AgentRow): Promise<AgentDetail> {
  const summary = await agentView(agent);
  const siblings = listAgentsOfPerson(agent.person_id).filter((a) => a.kind === "seller" && a.key !== agent.key);
  return {
    ...summary,
    hires: listHiresForAgent(agent.key, 60).map(hireView),
    ensAppUrl: ensAppUrl(agent.ens_name),
    hederaAccountUrl: hashscanAccountUrl(agent.hedera_account_id),
    siblingAgents: await Promise.all(siblings.map(agentView)),
  };
}
