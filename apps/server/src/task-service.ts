/** Creating, hiring for and refunding proof-of-work tasks. */
import fs from "node:fs/promises";
import path from "node:path";
import { keccak256, stringToHex, zeroAddress, type Hex } from "viem";
import {
  ESCROW_CHAIN_ID,
  canonicalJson,
  formatUnits6,
  mockUsdcAbi,
  parseUnits6,
  type CreateDuelRequest,
  type CreateTaskRequest,
  type CalibrationReport,
  type HiddenTestsBundle,
  type PublishedTests,
  type SpendEventView,
  type SpendGuard,
  type TaskSpec,
} from "@ethernals/shared";
import { hireAsAgent } from "./buyer";
import { ROOT_DIR, config } from "./config";
import { randomId } from "./crypto";
import {
  getAgent,
  getAgentByEnsName,
  getAgentByLabel,
  getTask,
  insertDuel,
  insertTask,
  isTestsInUse,
  listAgentsOfPerson,
  updateTask,
  type AgentRow,
  type PersonRow,
  type TaskRow,
} from "./db";
import { sepoliaPublic } from "./ens";
import { AppError, badRequest, conflict, forbidden, notFound } from "./errors";
import { emit, log } from "./events";
import { ensureTusdc, fundTask, fundingCalls, getTaskOnChain, refundOnChain } from "./escrow";
import { guardFor, recordSpend, spendEventView } from "./spend";
import { calibrateTests, getRevealedTests, uploadHiddenTests } from "./verifier-client";

export const REFUND_GRACE_MS = 30 * 60 * 1000;
const DUEL_DEADLINE_MINUTES = 30;
const OVERSPEND_FALLBACK_USDC = "50.000000";

// ---------------------------------------------------------------- hashes

export const specHashOf = (spec: TaskSpec): Hex => keccak256(stringToHex(canonicalJson(spec)));

export function testsHashOf(bundle: HiddenTestsBundle): Hex {
  const files = [...bundle.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return keccak256(stringToHex(canonicalJson({ files })));
}

export const validationRequestHash = (v: { chainTaskId: string; specHash: Hex; patchHash: Hex; testsHash: Hex }): Hex =>
  keccak256(stringToHex(canonicalJson(v)));

// ---------------------------------------------------------------- templates

interface Template {
  spec: Omit<TaskSpec, "version" | "kind" | "language">;
  hiddenTests: HiddenTestsBundle;
}

async function filesUnder(root: string, dir = ""): Promise<HiddenTestsBundle["files"]> {
  const out: HiddenTestsBundle["files"] = [];
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(root, relative)));
    else out.push({ path: relative, content: await fs.readFile(path.join(root, relative), "utf8") });
  }
  return out;
}

export async function loadTemplate(name: "slugify", tasksDir = path.join(ROOT_DIR, "demo", "tasks")): Promise<Template> {
  const dir = path.join(tasksDir, name);
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, "task.json"), "utf8");
  } catch {
    throw new AppError(503, `The "${name}" demo task is missing.`, "Dev A adds demo/tasks/slugify. Merge main.");
  }
  const { issueFile, ...fields } = JSON.parse(raw) as Template["spec"] & { issueFile?: string };
  const issue = issueFile ? (await fs.readFile(path.join(dir, issueFile), "utf8")).trim() : fields.issue;
  const spec: Template["spec"] = { title: fields.title, repoUrl: fields.repoUrl, baseCommit: fields.baseCommit, issue, testCommand: fields.testCommand };
  if (!/^[0-9a-f]{40}$/.test(spec.baseCommit ?? "") || !spec.repoUrl) {
    throw new AppError(503, `The "${name}" demo task has no repo yet.`, "Push demo/tasks/slugify/repo to GitHub, then fill repoUrl and baseCommit in demo/tasks/slugify/task.json.");
  }
  return { spec, hiddenTests: { files: await filesUnder(path.join(dir, "hidden_tests"), "") } };
}

/** Thrown when a guard refuses a bounty: a normal, displayable 409 that tells the UI the rule. */
export class SpendBlockedError extends AppError {
  constructor(guardKind: string, public readonly rule: string | null, public readonly reason: string) {
    const who = guardKind === "namera" ? "Namera policy" : "server limit";
    super(409, `Blocked by ${who}${rule ? `: ${rule}` : ""} — ${reason}`, undefined, { blocked: true, rule, reason, guard: guardKind });
  }
}

// ---------------------------------------------------------------- people and agents

export function clientBuyer(person: PersonRow): AgentRow {
  const buyer = listAgentsOfPerson(person.id).find((a) => a.kind === "buyer" && !a.arena_role);
  if (!buyer) throw new AppError(409, "Your buyer agent is still being created.", "Wait a few seconds and try again, or open /me.");
  return buyer;
}

export function resolveSpecialist(name: string): AgentRow {
  const agent = getAgentByEnsName(name) ?? getAgentByLabel(name);
  if (!agent || agent.kind !== "seller" || agent.task_type !== "code-fix") throw notFound(`No code-fix agent named ${name}.`);
  return agent;
}

// ---------------------------------------------------------------- create

export async function createTask(person: PersonRow, request: CreateTaskRequest, duelId: string | null = null): Promise<TaskRow> {
  const buyer = clientBuyer(person);
  const specialist = request.specialist ? resolveSpecialist(request.specialist) : null;
  const template = request.template ? await loadTemplate(request.template) : null;
  const source = template?.spec ?? request.spec;
  const hidden = template?.hiddenTests ?? request.hiddenTests;
  if (!source || !hidden) throw badRequest("Pick a template, or give a spec with hidden tests.");

  const spec: TaskSpec = {
    version: 1,
    kind: "code-fix",
    language: "python",
    title: source.title,
    repoUrl: source.repoUrl,
    baseCommit: source.baseCommit,
    issue: source.issue,
    testCommand: source.testCommand ?? "pytest -q",
  };

  const uploaded = await uploadHiddenTests(hidden);
  if (uploaded.testsHash !== testsHashOf(hidden)) {
    throw new AppError(502, "The verifier committed to a different tests hash than the tests we sent.");
  }

  // A pass pays the bounty and writes a 5-star rating, so tests that can't tell a fix from no fix are stopped before any
  // money moves. Templates are skipped: their tests are fixed, and the verifier's suite checks them the same way.
  const calibration = template
    ? null
    : await calibrateTests({
        repoUrl: spec.repoUrl,
        baseCommit: spec.baseCommit,
        testsId: uploaded.testsId,
        testsHash: uploaded.testsHash,
        testCommand: spec.testCommand,
        referencePatch: request.checks?.referencePatch || undefined,
        naivePatch: request.checks?.naivePatch || undefined,
      });
  if (calibration && !calibration.ok) {
    throw new AppError(422, `These tests can't back a bounty. ${calibration.reasons.join(" ")}`, "Nothing was funded. Change the tests or the patches and try again.", { calibration });
  }

  const id = randomId("task");
  const specHash = specHashOf(spec);
  const bountyUnits = parseUnits6(request.bounty);
  const deadline = new Date(Date.now() + request.deadlineMinutes * 60 * 1000);
  insertTask({
    id,
    chain_task_id: null,
    duel_id: duelId,
    client_person_id: person.id,
    client_agent_key: buyer.key,
    specialist_agent_key: specialist?.key ?? null,
    template: request.template ?? null,
    spec_json: canonicalJson(spec),
    spec_hash: specHash,
    tests_id: uploaded.testsId,
    tests_hash: uploaded.testsHash,
    calibration_json: calibration ? JSON.stringify(calibration) : null,
    bounty: bountyUnits.toString(),
    deadline: deadline.toISOString(),
    status: "creating",
    patch: null,
    patch_hash: null,
    explanation: null,
    verify_job_id: null,
    result_json: null,
    hire_id: null,
    rating_submitted: 0,
    create_tx: null,
    accept_tx: null,
    submit_tx: null,
    settle_tx: null,
    refund_tx: null,
    erc8004_request_hash: null,
    erc8004_request_tx: null,
    erc8004_response_tx: null,
    error: null,
  });

  const guard = await guardFor(person, buyer);
  const outcome = await fundTask({
    person,
    guard,
    taskId: id,
    bountyUnits,
    deadlineSeconds: BigInt(Math.floor(deadline.getTime() / 1000)),
    specialist: (specialist?.evm_address as Hex | undefined) ?? zeroAddress,
    specHash,
    testsHash: uploaded.testsHash,
    specURI: `${config.publicBaseUrl}/api/tasks/${id}/spec.json`,
    purpose: `fund task ${id}`,
  });

  if (outcome.status === "blocked") {
    const blocked = new SpendBlockedError(guard.kind, outcome.rule, outcome.reason);
    updateTask(id, { status: "error", error: blocked.message });
    throw blocked;
  }
  if (outcome.status === "failed") {
    updateTask(id, { status: "error", error: outcome.error });
    throw new AppError(502, "Funding the bounty failed, so no task was created.", outcome.error);
  }

  const created = updateTask(id, { status: "open", chain_task_id: outcome.chainTaskId, create_tx: outcome.txHash });
  emit("task.created", { taskId: id, chainTaskId: outcome.chainTaskId, message: `Task ${outcome.chainTaskId} funded with ${request.bounty} tUSDC` });
  return created;
}

// ---------------------------------------------------------------- hire

const hiring = new Set<string>();

/** The client's buyer agent pays the x402 attempt fee on Hedera. The rating comes later, from the verifier. */
export async function hireSpecialist(person: PersonRow, taskId: string, specialistName: string): Promise<TaskRow> {
  const task = getTask(taskId);
  if (!task) throw notFound("Unknown task.");
  if (task.client_person_id !== person.id) throw forbidden("Only the client who posted this task can hire for it.");
  if (task.status !== "open") throw conflict(`This task is ${task.status}, so it cannot be hired for.`);
  const specialist = resolveSpecialist(specialistName);
  if (task.specialist_agent_key && task.specialist_agent_key !== specialist.key) {
    throw conflict("This task is reserved for a different specialist.");
  }
  if (hiring.has(taskId)) throw conflict("A hire for this task is already running.");

  hiring.add(taskId);
  try {
    updateTask(taskId, { specialist_agent_key: specialist.key });
    const hired = await hireAsAgent({
      buyer: getAgent(task.client_agent_key)!,
      targetEnsName: specialist.ens_name,
      input: "",
      taskId,
      consent: { forward: false, subBudget: "0" },
    });
    return updateTask(taskId, { hire_id: hired.hireId });
  } finally {
    hiring.delete(taskId);
  }
}

// ---------------------------------------------------------------- published tests

/**
 * Custom tests go public once the outcome is on-chain, so anyone can see what earned a rating. Three exceptions stay hidden:
 * templates, whose tests are reused by later tasks; tasks posted before this promise existed (they have no calibration);
 * and tests another live task still shares.
 */
export function areTestsPublic(task: TaskRow): boolean {
  if (task.status !== "passed" && task.status !== "failed") return false;
  if (!task.calibration_json || !task.tests_id || !task.verify_job_id) return false;
  return !isTestsInUse(task.tests_id, task.id);
}

export async function publishedTests(task: TaskRow): Promise<PublishedTests> {
  if (!areTestsPublic(task)) throw conflict("These tests are hidden.", "Custom tests are published after the task settles.");
  const { files, testsHash } = await getRevealedTests(task.verify_job_id!);
  if (testsHash !== task.tests_hash || testsHashOf({ files }) !== task.tests_hash) {
    throw new AppError(502, "The verifier returned tests that do not match the on-chain hash.");
  }
  return { testsHash, files, calibration: JSON.parse(task.calibration_json!) as CalibrationReport };
}

// ---------------------------------------------------------------- refund

/** After the deadline if nobody submitted; a submitted task gets a 30-minute grace for the verifier to settle. */
export function refundEligibleAt(status: TaskRow["status"], deadline: string): number | null {
  const at = new Date(deadline).getTime();
  if (status === "open" || status === "accepted" || status === "error") return at;
  if (status === "submitted" || status === "verifying") return at + REFUND_GRACE_MS;
  return null;
}

export function canRefund(status: TaskRow["status"], deadline: string, now = Date.now()): boolean {
  const eligibleAt = refundEligibleAt(status, deadline);
  return eligibleAt !== null && now >= eligibleAt;
}

export async function refundTask(person: PersonRow, taskId: string): Promise<TaskRow> {
  const task = getTask(taskId);
  if (!task) throw notFound("Unknown task.");
  if (task.client_person_id !== person.id) throw forbidden("Only the client who posted this task can refund it.");
  if (!task.chain_task_id) throw conflict("This task was never funded, so there is nothing to refund.");

  const onChain = await getTaskOnChain(task.chain_task_id);
  const status = onChain.status === "Open" ? "open" : onChain.status === "Accepted" ? "accepted" : onChain.status === "Submitted" ? "submitted" : null;
  if (!status) throw conflict(`This task is already ${onChain.status.toLowerCase()} on-chain.`);
  if (!canRefund(status, task.deadline)) throw conflict("This task cannot be refunded yet.", "Refunds open after the deadline, plus 30 minutes if a patch was submitted.");

  const guard = await guardFor(person, clientBuyer(person));
  const result = await refundOnChain(person, guard, task.id, task.chain_task_id, BigInt(task.bounty));
  if (result.status === "blocked") throw new SpendBlockedError(guard.kind, result.rule, result.reason);
  if (result.status === "failed") throw new AppError(502, "The refund transaction failed.", result.error);
  // The watcher finishes the task when it sees Refunded on-chain; recording the hash here keeps the link.
  return updateTask(task.id, { refund_tx: result.txHash });
}

// ---------------------------------------------------------------- duel

/** Two directed tasks from one template, hired in parallel. Funding is in order; the hires run in the background. */
export async function createDuel(person: PersonRow, request: CreateDuelRequest): Promise<{ id: string; tasks: [TaskRow, TaskRow] }> {
  const [first, second] = request.specialists.map(resolveSpecialist);
  if (first.key === second.key) throw badRequest("Pick two different specialists.");

  const id = randomId("duel");
  insertDuel(id);
  const fund = (specialist: AgentRow) =>
    createTask(person, { template: request.template, bounty: request.bounty, deadlineMinutes: DUEL_DEADLINE_MINUTES, specialist: specialist.ens_name }, id);
  const tasks: [TaskRow, TaskRow] = [await fund(first), await fund(second)];

  for (const [task, specialist] of [[tasks[0], first], [tasks[1], second]] as const) {
    void hireSpecialist(person, task.id, specialist.ens_name).catch((err: Error) => {
      log.error(`duel hire failed for ${specialist.ens_name}`, err);
      updateTask(task.id, { error: err.message });
      emit("info", { taskId: task.id, agentEnsName: specialist.ens_name, message: `Duel hire failed: ${err.message}` });
    });
  }
  return { id, tasks };
}

// ---------------------------------------------------------------- demo: overspend

/** Tries a bounty far above the policy cap. Never sends when no cap is known, because then nothing would stop it. */
export async function tryOverspend(person: PersonRow, guard: SpendGuard): Promise<SpendEventView> {
  const policy = await guard.policy();
  const cap = policy.tokenAllowanceUsdc;
  const purpose = "demo: try an overspend";
  if (cap === null) {
    const units = parseUnits6(OVERSPEND_FALLBACK_USDC);
    const reason = "This policy shows no token cap, so nothing here would stop the spend. Refused to send it.";
    const row = recordSpend({ person, taskId: null, guard: guard.kind, purpose, amountUnits: units, result: { status: "failed", guard: guard.kind, error: reason } });
    return spendEventView(row);
  }
  const units = parseUnits6(cap) * 5n;
  const spec: TaskSpec = { version: 1, kind: "code-fix", language: "python", title: "Overspend probe", repoUrl: "https://github.com/ethernals/none", baseCommit: "0".repeat(40), issue: "Never created." };
  const specHash = specHashOf(spec);
  if (guard.kind === "namera") await ensureTusdc(policy.accountAddress, units);
  const result = await guard.execute({
    chainId: ESCROW_CHAIN_ID,
    purpose,
    amountUsdc: formatUnits6(units),
    calls: fundingCalls({
      bountyUnits: units,
      deadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 3600),
      specialist: zeroAddress,
      specHash,
      testsHash: specHash,
      specURI: "",
    }),
  });
  if (result.status === "confirmed") log.error("overspend probe was NOT blocked", { guard: guard.kind, txHash: result.txHash });
  return spendEventView(recordSpend({ person, taskId: null, guard: guard.kind, purpose, amountUnits: units, result }));
}

/** The tUSDC balance of a guard's account, for display. */
export async function tusdcBalance(address: Hex): Promise<string | null> {
  const token = config.escrow.tokenOrNull();
  if (!token) return null;
  return formatUnits6(await sepoliaPublic.readContract({ address: token, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] }));
}
