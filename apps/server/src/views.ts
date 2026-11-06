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
  type CalibrationReport,
  type DuelView,
  type TaskLinks,
  type TaskSpec,
  type TaskView,
  type VerificationResult,
  type HireStatus,
  type HireView,
  type PersonPublic,
  type Reason,
} from "@ethernals/shared";
import { providerKeyShort } from "./agents";
import { taskReceipts } from "./brain";
import { config } from "./config";
import {
  countSpecialistTasks,
  getAgent,
  getHire,
  getPerson,
  kvGet,
  listAgentsOfPerson,
  listHiresForAgent,
  listSpendEventsForTask,
  listTasksOfDuel,
  type AgentRow,
  type HireRow,
  type PersonRow,
  type TaskRow,
} from "./db";
import { getStats, type LedgerStats } from "./ledger";
import { spendEventView } from "./spend";
import { areTestsPublic, canRefund, refundEligibleAt } from "./task-service";

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

/** TaskView plus what the shared type does not carry yet (additive, read by apps/web). */
export interface TaskDetailView extends TaskView {
  hire: HireView | null;
  scoreChange: { before: string | null; after: string | null } | null;
  duelId: string | null;
  refundableAt: string | null;
  refundable: boolean;
}

const url = <T>(value: T | null | undefined, make: (v: T) => string) => (value ? make(value) : null);

export function taskView(t: TaskRow): TaskDetailView {
  const client = getAgent(t.client_agent_key);
  const specialist = t.specialist_agent_key ? getAgent(t.specialist_agent_key) : undefined;
  const hire = t.hire_id ? getHire(t.hire_id) : undefined;
  const result = t.result_json ? (JSON.parse(t.result_json) as VerificationResult) : null;
  const links: TaskLinks = {
    createTx: url(t.create_tx, sepoliaTxUrl),
    acceptTx: url(t.accept_tx, sepoliaTxUrl),
    submitTx: url(t.submit_tx, sepoliaTxUrl),
    settleTx: url(t.settle_tx, sepoliaTxUrl),
    refundTx: url(t.refund_tx, sepoliaTxUrl),
    x402Payment: url(hire?.payment_tx_id, hashscanTxUrl),
    erc8004Request: url(t.erc8004_request_tx, sepoliaTxUrl),
    erc8004Response: url(t.erc8004_response_tx, sepoliaTxUrl),
    hireLedger: url(hire?.ledger_tx_hash, hashscanEvmTxUrl),
    result: kvGet<string>(`task.result-url.${t.id}`),
  };
  const refundAt = refundEligibleAt(t.status, t.deadline);
  return {
    id: t.id,
    chainTaskId: t.chain_task_id,
    spec: JSON.parse(t.spec_json) as TaskSpec,
    specHash: t.spec_hash as TaskView["specHash"],
    testsHash: t.tests_hash as TaskView["testsHash"],
    calibration: t.calibration_json ? (JSON.parse(t.calibration_json) as CalibrationReport) : null,
    testsUrl: areTestsPublic(t) ? `/api/tasks/${t.id}/tests.json` : null,
    bounty: formatUnits6(BigInt(t.bounty)),
    deadline: t.deadline,
    status: t.status,
    clientHandle: getPerson(t.client_person_id)?.handle ?? "?",
    clientAgentEnsName: client?.ens_name ?? "?",
    specialistEnsName: specialist?.ens_name ?? null,
    patch: t.patch,
    patchHash: t.patch_hash as TaskView["patchHash"],
    explanation: t.explanation,
    verifyJobId: t.verify_job_id,
    result,
    hireId: t.hire_id,
    inference: taskReceipts(t.id),
    spend: listSpendEventsForTask(t.id).map(spendEventView),
    links,
    error: t.error,
    createdAt: t.created_at,
    hire: hire ? hireView(hire) : null,
    scoreChange: kvGet<{ before: string | null; after: string | null }>(`task.score.${t.id}`),
    duelId: t.duel_id,
    refundableAt: refundAt === null || !t.chain_task_id ? null : new Date(refundAt).toISOString(),
    refundable: Boolean(t.chain_task_id) && canRefund(t.status, t.deadline),
  };
}

export function duelView(id: string): DuelView {
  const [first, second] = listTasksOfDuel(id).map(taskView);
  return { id, tasks: [first, second] };
}

export async function agentDetail(agent: AgentRow): Promise<AgentDetail & { erc8004AgentId: string | null; tasksPassed: number; tasksFailed: number; strategy: AgentRow["strategy"] }> {
  const summary = await agentView(agent);
  const siblings = listAgentsOfPerson(agent.person_id).filter((a) => a.kind === "seller" && a.key !== agent.key);
  const tasks = countSpecialistTasks(agent.key);
  return {
    ...summary,
    erc8004AgentId: agent.erc8004_agent_id,
    tasksPassed: tasks.passed,
    tasksFailed: tasks.failed,
    strategy: agent.strategy,
    hires: listHiresForAgent(agent.key, 60).map(hireView),
    ensAppUrl: ensAppUrl(agent.ens_name),
    hederaAccountUrl: hashscanAccountUrl(agent.hedera_account_id),
    siblingAgents: await Promise.all(siblings.map(agentView)),
  };
}
