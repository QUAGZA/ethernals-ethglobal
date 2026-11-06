/**
 * Seller agent runtime: runs a paid task in a fresh workspace with no shared memory (PRD SEC-1..6).
 * The only way hire data can reach another agent is `subHire()`, which checks the hirer's mandate in code.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { formatUnits6, hashscanTxUrl, type SubHireOutcome } from "@ethernals/shared";
import { z } from "zod";
import { config } from "./config";
import { randomId, sha256Hex } from "./crypto";
import {
  addMandateSpend,
  getAgentBrain,
  getAgentByEnsName,
  getAgentByLabel,
  getMandate,
  insertHire,
  insertMandate,
  updateHire,
  type AgentRow,
  type MandateRow,
} from "./db";
import { runCustomAgent } from "./custom-agent";
import { emit, log } from "./events";
import { ToolError } from "./tools";
import { summarize, translate } from "./llm";
import { quoteUnits } from "./payments";
import { withWorkspace } from "./sandbox";
import { parseUnits6 } from "@ethernals/shared";

export const taskBodySchema = z.object({
  input: z.string().min(1, "Input text is empty.").max(8000, "Input is limited to 8,000 characters."),
  translateTo: z.enum(["hi", "mr"]).nullish(),
  buyerAgent: z.string().min(3),
  consent: z
    .object({ forward: z.boolean().default(false), subBudget: z.string().default("0") })
    .default({ forward: false, subBudget: "0" }),
  parentHireId: z.string().nullish(),
  arena: z.boolean().optional(),
});

export type TaskBody = z.infer<typeof taskBodySchema>;

/** Express handler for POST /a/:label/task (runs after the x402 middleware verified payment). */
export async function handleSellerTask(req: Request, res: Response): Promise<void> {
  const label = String(req.params.label);
  const seller = getAgentByLabel(label);
  if (!seller || seller.kind !== "seller") {
    res.status(404).json({ error: `No agent named ${label}.` });
    return;
  }
  const parsed = taskBodySchema.safeParse(req.body);
  if (!parsed.success) {
    // Status >= 400 means the x402 middleware will NOT settle, so the buyer is not charged.
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  const body = parsed.data;
  const buyer = getAgentByEnsName(body.buyerAgent) ?? getAgentByLabel(body.buyerAgent);
  if (!buyer) {
    res.status(400).json({ error: `Unknown buyer agent ${body.buyerAgent}.` });
    return;
  }

  const quoted = await quoteUnits(seller);
  const hireId = randomId("hire");
  let subBudget = 0n;
  try {
    subBudget = parseUnits6(body.consent.subBudget || "0");
  } catch {
    subBudget = 0n;
  }
  const mandate: MandateRow = insertMandate({
    id: randomId("mandate"),
    hire_id: hireId,
    forward: body.consent.forward ? 1 : 0,
    sub_budget: subBudget.toString(),
    spent: "0",
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  insertHire({
    id: hireId,
    agent_key: seller.key,
    buyer_agent_key: buyer.key,
    quoted_price: quoted.toString(),
    paid_amount: null,
    payment_tx_id: null,
    input_hash: sha256Hex(body.input),
    output_hash: null,
    mandate_id: mandate.id,
    rating: null,
    rated_at: null,
    counted: null,
    reason: null,
    status: "delivered",
    ledger_tx_hash: null,
    ens_tx_hash: null,
    parent_hire_id: body.parentHireId ?? null,
    arena: body.arena ? 1 : 0,
  });

  try {
    const { result, subHire } = await withWorkspace(hireId, async (dir) => {
      // The workspace is the only place this hire's data touches disk, and it is deleted afterwards.
      await fs.writeFile(path.join(dir, "input.txt"), body.input, "utf8");
      return runTask(seller, body, hireId, mandate);
    });
    updateHire(hireId, { output_hash: sha256Hex(result) });
    emit("hire.delivered", { hireId, agentEnsName: seller.ens_name, message: `${seller.ens_name} delivered for ${buyer.ens_name}` });
    res.json({ hireId, result, quotedPrice: formatUnits6(quoted), subHire });
  } catch (err) {
    updateHire(hireId, { status: "failed" });
    log.error(`task failed for ${seller.ens_name}`, err);
    res.status(500).json({ error: "The agent could not complete this task.", hint: (err as Error).message });
  }
}

async function runTask(
  seller: AgentRow,
  body: TaskBody,
  hireId: string,
  mandate: MandateRow,
): Promise<{ result: string; subHire: SubHireOutcome | null }> {
  if (seller.task_type === "custom") return runCustom(seller, body, hireId, mandate);
  if (seller.task_type === "translate") {
    return { result: await translate(body.input, body.translateTo ?? "hi", { agent: seller.ens_name }), subHire: null };
  }
  const summary = await summarize(body.input, { agent: seller.ens_name });
  if (!body.translateTo) return { result: summary, subHire: null };

  // Deterministic sub-hire trigger (PRD SUB-2): "also translate" sends the summary to a translate agent.
  const outcome = await subHire({ seller, hireId, mandateId: mandate.id, data: summary, translateTo: body.translateTo });
  if (outcome.status === "done" && outcome.result) {
    return { result: `${summary}\n\n---\n${outcome.result}`, subHire: stripResult(outcome) };
  }
  return { result: summary, subHire: stripResult(outcome) };
}

function stripResult(o: SubHireOutcome & { result?: string }): SubHireOutcome {
  const { result: _drop, ...rest } = o;
  return rest;
}

/**
 * The single function that may send hire data to another agent (PRD SUB-3).
 * It checks the hirer's consent and sub-budget in code before anything leaves this process.
 */
export async function subHire(params: {
  seller: AgentRow;
  hireId: string;
  mandateId: string;
  data: string;
  translateTo: string;
}): Promise<SubHireOutcome & { result?: string }> {
  const mandate = getMandate(params.mandateId);
  const target = findTranslateAgent(params.seller);
  if (!target) return { status: "skipped", reason: "No translate agent is registered yet." };

  if (!mandate || mandate.forward !== 1) {
    emit("subhire.blocked", {
      hireId: params.hireId,
      agentEnsName: params.seller.ens_name,
      reason: "SUBHIRE_BLOCKED_NO_CONSENT",
      message: `Blocked: ${params.seller.ens_name} tried to share this hire's data with ${target.ens_name} without consent.`,
    });
    return { status: "blocked", reason: "SUBHIRE_BLOCKED_NO_CONSENT", agentEnsName: target.ens_name };
  }
  const price = await quoteUnits(target);
  const remaining = BigInt(mandate.sub_budget) - BigInt(mandate.spent);
  if (new Date(mandate.expires_at).getTime() < Date.now() || price > remaining) {
    emit("subhire.blocked", {
      hireId: params.hireId,
      agentEnsName: params.seller.ens_name,
      reason: "SUBHIRE_BLOCKED_BUDGET",
      message: `Blocked: ${target.ens_name} costs ${formatUnits6(price)}, above the remaining sub-budget ${formatUnits6(remaining)}.`,
    });
    return { status: "blocked", reason: "SUBHIRE_BLOCKED_BUDGET", agentEnsName: target.ens_name };
  }

  // Imported lazily to avoid a cycle (buyer -> payments -> agent-runtime).
  const { hireAsAgent } = await import("./buyer");
  try {
    const hired = await hireAsAgent({
      buyer: params.seller,
      targetEnsName: target.ens_name,
      input: params.data,
      translateTo: params.translateTo as "hi",
      consent: { forward: false, subBudget: "0" },
      maxUnits: remaining,
      parentHireId: params.hireId,
      autoRate: true,
    });
    addMandateSpend(mandate.id, price);
    return {
      status: "done",
      agentEnsName: target.ens_name,
      hireId: hired.hireId,
      paymentUrl: hired.paymentTxId ? hashscanTxUrl(hired.paymentTxId) : null,
      result: hired.result,
    };
  } catch (err) {
    log.error("sub-hire failed", err);
    return { status: "failed", reason: (err as Error).message, agentEnsName: target.ens_name };
  }
}

function findTranslateAgent(seller: AgentRow): AgentRow | undefined {
  const preferred = getAgentByLabel("translate");
  if (preferred && preferred.kind === "seller" && preferred.key !== seller.key) return preferred;
  return undefined;
}

export const internalTaskUrl = (label: string) => `${config.internalBaseUrl}/a/${label}/task`;

/** A hoster custom agent: its own specialization, tools and 0G key. Sub-hires are gated by the customer consent. */
async function runCustom(
  seller: AgentRow,
  body: TaskBody,
  hireId: string,
  mandate: MandateRow,
): Promise<{ result: string; subHire: SubHireOutcome | null }> {
  const brain = getAgentBrain(seller.key);
  if (!brain) throw new Error("This agent has no brain configured.");
  let lastOutcome: SubHireOutcome | null = null;
  const run = await runCustomAgent({
    agent: seller,
    brain,
    task: body.input,
    taskId: hireId,
    hire: async (label, task) => {
      const outcome = await hireOther({ seller, hireId, mandateId: mandate.id, targetLabel: label, data: task });
      lastOutcome = stripResult(outcome);
      if (outcome.status !== "done" || outcome.result === undefined) {
        throw new ToolError(`Could not hire ${label}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}.`);
      }
      return outcome.result;
    },
  });
  return { result: run.result, subHire: lastOutcome };
}

/**
 * Hire any other seller agent on behalf of the hired agent. Same rules as every sub-hire: the customer must have
 * allowed it, the price must fit the remaining sub-budget, and the sub-hired agent gets NO right to sub-hire again.
 */
export async function hireOther(params: {
  seller: AgentRow;
  hireId: string;
  mandateId: string;
  targetLabel: string;
  data: string;
}): Promise<SubHireOutcome & { result?: string }> {
  const target = getAgentByLabel(params.targetLabel.trim().toLowerCase());
  if (!target || target.kind !== "seller") return { status: "skipped", reason: `No agent named "${params.targetLabel}".` };
  if (target.key === params.seller.key) return { status: "skipped", reason: "An agent cannot hire itself.", agentEnsName: target.ens_name };
  const mandate = getMandate(params.mandateId);

  if (!mandate || mandate.forward !== 1) {
    emit("subhire.blocked", {
      hireId: params.hireId,
      agentEnsName: params.seller.ens_name,
      reason: "SUBHIRE_BLOCKED_NO_CONSENT",
      message: `Blocked: ${params.seller.ens_name} tried to share this hire's data with ${target.ens_name} without consent.`,
    });
    return { status: "blocked", reason: "SUBHIRE_BLOCKED_NO_CONSENT", agentEnsName: target.ens_name };
  }
  const price = await quoteUnits(target);
  const remaining = BigInt(mandate.sub_budget) - BigInt(mandate.spent);
  if (new Date(mandate.expires_at).getTime() < Date.now() || price > remaining) {
    emit("subhire.blocked", {
      hireId: params.hireId,
      agentEnsName: params.seller.ens_name,
      reason: "SUBHIRE_BLOCKED_BUDGET",
      message: `Blocked: ${target.ens_name} costs ${formatUnits6(price)}, above the remaining sub-budget ${formatUnits6(remaining)}.`,
    });
    return { status: "blocked", reason: "SUBHIRE_BLOCKED_BUDGET", agentEnsName: target.ens_name };
  }

  const { hireAsAgent } = await import("./buyer");
  try {
    const hired = await hireAsAgent({
      buyer: params.seller,
      targetEnsName: target.ens_name,
      input: params.data.slice(0, 8000),
      consent: { forward: false, subBudget: "0" },
      maxUnits: remaining,
      parentHireId: params.hireId,
      autoRate: true,
    });
    addMandateSpend(mandate.id, price);
    return {
      status: "done",
      agentEnsName: target.ens_name,
      hireId: hired.hireId,
      paymentUrl: hired.paymentTxId ? hashscanTxUrl(hired.paymentTxId) : null,
      result: hired.result,
    };
  } catch (err) {
    log.error("sub-hire failed", err);
    return { status: "failed", reason: (err as Error).message, agentEnsName: target.ens_name };
  }
}
