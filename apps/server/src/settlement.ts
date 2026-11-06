/**
 * Watches escrow state on Sepolia and turns outcomes into reputation and earnings. Polling getTask needs no log ranges,
 * which free RPC plans limit. A task settles exactly once: finishTask only lets the first caller through.
 */
import type { Hex } from "viem";
import { formatScore, sepoliaTxUrl } from "@ethernals/shared";
import { creditEarnings } from "./brain";
import { config } from "./config";
import { finishTask, getAgent, getHire, getTask, kvSet, listLiveTasks, listUnratedSettledTasks, updateTask, type TaskRow } from "./db";
import { getTaskOnChain } from "./escrow";
import { emit, log, subscribe } from "./events";
import { getStats } from "./ledger";
import { submitRating } from "./verifier";
import { getVerifyJob } from "./verifier-client";

const POLL_MS = 4000;
const RECORD_WAIT_MS = 45_000;

export const ratingFor = (passed: boolean) => (passed ? 5 : 1);

async function scoreNow(agentKey: string): Promise<string | null> {
  try {
    return formatScore((await getStats(agentKey as Hex)).scoreX1e6);
  } catch {
    return null;
  }
}

/** Resolves with the score and price the HireLedger recorded for this hire, or null if it takes too long. */
function waitForRecorded(hireId: string, ms: number): Promise<{ score?: string; price?: string } | null> {
  return new Promise((resolve) => {
    const finish = (value: { score?: string; price?: string } | null) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), ms);
    const unsubscribe = subscribe((message) => {
      if (message.type === "hire.recorded" && message.data.hireId === hireId) finish({ score: message.data.score, price: message.data.price });
    });
  });
}

const rating = new Set<string>();

/** Sends the verified outcome to the HireLedger. Returns null if the x402 receipt has not arrived yet, so it can retry. */
async function rateOutcome(task: TaskRow, passed: boolean, waitMs: number): Promise<{ score?: string; price?: string } | null> {
  const hire = task.hire_id ? getHire(task.hire_id) : undefined;
  if (!hire?.payment_tx_id || rating.has(task.id)) return null;
  rating.add(task.id);
  try {
    const specialist = getAgent(hire.agent_key);
    const before = specialist ? await scoreNow(specialist.key) : null;
    const recorded = waitForRecorded(hire.id, waitMs);
    await submitRating({ hireId: hire.id, rating: ratingFor(passed), paymentTxId: hire.payment_tx_id });
    updateTask(task.id, { rating_submitted: 1 });
    const outcome = await recorded;
    kvSet(`task.score.${task.id}`, { before, after: outcome?.score ?? null });
    return outcome;
  } finally {
    rating.delete(task.id);
  }
}

async function settle(task: TaskRow, passed: boolean, waitMs: number): Promise<void> {
  const job = task.verify_job_id ? await getVerifyJob(task.verify_job_id).catch(() => null) : null;
  const won = finishTask(task.id, passed ? "passed" : "failed", {
    settle_tx: job?.settleTxHash ?? null,
    result_json: job?.result ? JSON.stringify(job.result) : null,
    erc8004_response_tx: job?.erc8004TxHash ?? null,
    error: null,
  });
  if (!won) return;
  if (job?.resultUrl) kvSet(`task.result-url.${task.id}`, job.resultUrl);

  // Earnings first, so the one ENS write the rating triggers already carries them.
  const specialist = task.specialist_agent_key ? getAgent(task.specialist_agent_key) : undefined;
  if (passed && specialist) creditEarnings(specialist, BigInt(task.bounty));

  let outcome: { score?: string; price?: string } | null = null;
  try {
    outcome = await rateOutcome(task, passed, waitMs);
  } catch (err) {
    log.warn("rating will retry", { taskId: task.id, error: (err as Error).message });
  }

  emit("task.settled", {
    taskId: task.id,
    passed,
    agentEnsName: specialist?.ens_name,
    settleTxUrl: job?.settleTxHash ? sepoliaTxUrl(job.settleTxHash) : null,
    reason: (job?.result?.failureReason ?? undefined) as never,
    score: outcome?.score,
    price: outcome?.price,
    message: passed ? `PASS: ${specialist?.ens_name ?? "specialist"} was paid` : `FAIL: the client was refunded`,
  });
}

function refunded(task: TaskRow): void {
  if (!finishTask(task.id, "refunded")) return;
  emit("task.refunded", { taskId: task.id, message: `Task ${task.chain_task_id} refunded to the client` });
}

/** One pass over every live task. Exported so tests can drive it. */
export async function pollEscrow(waitMs = RECORD_WAIT_MS): Promise<void> {
  if (!config.escrow.addressOrNull()) return;
  await Promise.all(
    listLiveTasks().map(async (task) => {
      try {
        const { status } = await getTaskOnChain(task.chain_task_id!);
        if (status === "Passed" || status === "Failed") await settle(task, status === "Passed", waitMs);
        else if (status === "Refunded") refunded(task);
      } catch (err) {
        log.warn("escrow poll failed", { taskId: task.id, error: (err as Error).message });
      }
    }),
  );
  await Promise.all(
    listUnratedSettledTasks().map(async (task) => {
      try {
        const fresh = getTask(task.id)!;
        const outcome = await rateOutcome(fresh, fresh.status === "passed", waitMs);
        if (outcome) emit("info", { taskId: task.id, message: `HireLedger recorded the outcome: score ${outcome.score ?? "?"}` });
      } catch (err) {
        log.warn("rating retry failed", { taskId: task.id, error: (err as Error).message });
      }
    }),
  );
}

let polling = false;

export function startEscrowWatcher(): NodeJS.Timeout {
  return setInterval(() => {
    if (polling) return;
    polling = true;
    void pollEscrow()
      .catch((err) => log.error("escrow watcher failed", err))
      .finally(() => {
        polling = false;
      });
  }, POLL_MS);
}

