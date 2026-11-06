/**
 * The code-fix runtime, run inside a paid x402 hire: accept on-chain, think on 0G, submit the patch, ask for validation
 * and start verification. A thrown error means the x402 middleware does not settle, so the client is not charged.
 */
import { keccak256, stringToHex, type Hex } from "viem";
import type { TaskSpec } from "@ethernals/shared";
import { cloneRepo, runCodingAgent } from "./coding-agent";
import { config } from "./config";
import { getTask, updateTask, type AgentRow, type TaskRow } from "./db";
import { acceptOnChain, requestValidation, submitOnChain } from "./escrow";
import { emit, log } from "./events";
import { withWorkspace } from "./sandbox";
import { validationRequestHash } from "./task-service";
import { relayJobEvents, startVerify, verifierHealth } from "./verifier-client";

/** Why this hire must not run. Checked before any charge. */
export function codeFixRefusal(seller: AgentRow, buyer: AgentRow, taskId: string): string | null {
  const task = getTask(taskId);
  if (!task) return "Unknown task.";
  if (task.client_agent_key !== buyer.key) return "Only the task's client can hire for it.";
  if (task.status !== "open" && task.status !== "accepted") return `This task is ${task.status}.`;
  if (task.specialist_agent_key && task.specialist_agent_key !== seller.key) return "This task is reserved for a different specialist.";
  if (new Date(task.deadline).getTime() <= Date.now()) return "This task's deadline has passed.";
  return null;
}

async function startVerification(task: TaskRow, seller: AgentRow, spec: TaskSpec, patch: string, patchHash: Hex): Promise<string> {
  const chainTaskId = task.chain_task_id!;
  const requestHash = validationRequestHash({ chainTaskId, specHash: task.spec_hash as Hex, patchHash, testsHash: task.tests_hash as Hex });
  const health = await verifierHealth();

  let requested: Hex | null = null;
  if (seller.erc8004_agent_id) {
    requested = await requestValidation({
      validator: health.validator,
      agentId: seller.erc8004_agent_id,
      requestURI: `${config.publicBaseUrl}/api/tasks/${task.id}/spec.json`,
      requestHash,
    });
    updateTask(task.id, { erc8004_request_hash: requestHash, erc8004_request_tx: requested });
  }

  const { jobId } = await startVerify({
    taskId: task.id,
    chainTaskId,
    repoUrl: spec.repoUrl,
    baseCommit: spec.baseCommit,
    patch,
    testsId: task.tests_id!,
    testsHash: task.tests_hash as Hex,
    testCommand: spec.testCommand,
    erc8004RequestHash: requested ? requestHash : undefined,
    specialistAgentId: seller.erc8004_agent_id ?? undefined,
  });
  updateTask(task.id, { verify_job_id: jobId, status: "verifying" });
  void relayJobEvents(jobId, task.id);
  return jobId;
}

export async function runCodeFix(params: { seller: AgentRow; hireId: string; taskId: string }): Promise<{ taskId: string; patchHash: Hex; verifyJobId: string }> {
  const { seller, hireId, taskId } = params;
  const task = updateTask(taskId, { hire_id: hireId, specialist_agent_key: seller.key, error: null });
  const spec = JSON.parse(task.spec_json) as TaskSpec;
  const chainTaskId = task.chain_task_id!;

  try {
    if (task.status === "open") {
      const acceptTx = await acceptOnChain(seller, chainTaskId);
      updateTask(taskId, { accept_tx: acceptTx, status: "accepted" });
      emit("task.accepted", { taskId, agentEnsName: seller.ens_name, message: `${seller.ens_name} accepted task ${chainTaskId}` });
    }

    const { patch, explanation } = await withWorkspace(hireId, async (dir) => {
      await cloneRepo(spec.repoUrl, spec.baseCommit, dir);
      return runCodingAgent({ seller, taskId, spec, template: task.template, dir });
    });

    const patchHash = keccak256(stringToHex(patch));
    const submitTx = await submitOnChain(seller, chainTaskId, patchHash, `${config.publicBaseUrl}/api/tasks/${taskId}/patch.diff`);
    const submitted = updateTask(taskId, { patch, patch_hash: patchHash, explanation, submit_tx: submitTx, status: "submitted" });
    emit("task.submitted", { taskId, agentEnsName: seller.ens_name, message: `${seller.ens_name} submitted a patch` });

    const verifyJobId = await startVerification(submitted, seller, spec, patch, patchHash);
    return { taskId, patchHash, verifyJobId };
  } catch (err) {
    const message = (err as Error).message.split("\n")[0];
    log.error(`task ${taskId} failed`, err);
    updateTask(taskId, { status: "error", error: message });
    emit("info", { taskId, agentEnsName: seller.ens_name, message: `Task failed: ${message}` });
    throw err;
  }
}
