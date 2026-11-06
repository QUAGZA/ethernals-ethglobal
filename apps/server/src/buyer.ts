/**
 * Buyer agent runtime: discover an agent by ENS name, check policy, pay over x402 on Hedera, optionally rate.
 * Used for web hires (on behalf of a signed-in person), sub-hires and the Arena farm.
 */
import { formatUnits6, hashscanTxUrl, parseUnits6, toMirrorTxId, type Consent, type SubHireOutcome } from "@ethernals/shared";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { assertPublicUrl } from "./agent-tools";
import { isAgentRegistered, getPrice } from "./ledger";
import { config } from "./config";
import { decryptSecret } from "./crypto";
import { getAgentByEnsName, updateAgent, updateHire, type AgentRow } from "./db";
import { AppError } from "./errors";
import { log } from "./events";
import { internalTaskUrl } from "./agent-runtime";
import { readAgentRecords } from "./ens";
import { judge } from "./llm";
import { createPayingFetch, quoteUnits, settlementTxId } from "./payments";
import { createSafeFetch } from "./sandbox";
import { submitRating } from "./verifier";

export interface HireResult {
  hireId: string;
  result: string;
  quotedPrice: string;
  paymentTxId: string | null;
  paymentUrl: string | null;
  subHire: SubHireOutcome | null;
  discoveredVia: "ens" | "local";
}

export interface DiscoveredAgent {
  ensName: string;
  endpoint: string | null;
  price: string | null;
  score: string | null;
  via: "ens" | "local";
}

/** Reads the agent's public records from ENS (Sepolia); falls back to local data if ENS is unreachable. */
export async function discover(ensName: string): Promise<DiscoveredAgent> {
  try {
    const records = await readAgentRecords(ensName);
    if (records.endpoint) {
      return { ensName, endpoint: records.endpoint, price: records.price, score: records.score, via: "ens" };
    }
  } catch (err) {
    log.warn("ENS discovery failed, using local registry", { ensName, error: (err as Error).message });
  }
  const local = getAgentByEnsName(ensName);
  if (!local) throw new AppError(404, `No agent named ${ensName}.`);
  return { ensName, endpoint: internalTaskUrl(local.label), price: null, score: null, via: "local" };
}

export async function hireAsAgent(params: {
  buyer: AgentRow;
  targetEnsName: string;
  input: string;
  translateTo?: "hi" | "mr" | null;
  consent: Consent;
  maxUnits?: bigint;
  minScore?: number;
  parentHireId?: string | null;
  autoRate?: boolean;
  fixedRating?: number;
  arena?: boolean;
  /** A proof-of-work task: the x402 payment is the attempt fee. */
  taskId?: string;
}): Promise<HireResult> {
  const target = getAgentByEnsName(params.targetEnsName);
  const found = await discover(params.targetEnsName);
  if (params.minScore !== undefined && found.score !== null && Number(found.score) < params.minScore) {
    throw new AppError(409, `${params.targetEnsName} has score ${found.score}, below your minimum ${params.minScore}.`);
  }

  // Agents hosted by this server are called directly (never through a public tunnel).
  const url = target ? internalTaskUrl(target.label) : found.endpoint;
  if (!url) throw new AppError(404, `${params.targetEnsName} has no x402 endpoint record.`);

  const quote = target
    ? await quoteUnits(target)
    : await getPrice(namehash(params.targetEnsName) as Hex).catch(() => (found.price ? parseUnits6(found.price) : 0n));
  const budget = params.maxUnits ?? BigInt(params.buyer.budget_remaining || "0");
  if (quote > budget) {
    throw new AppError(
      402,
      `${params.targetEnsName} costs ${formatUnits6(quote)}, more than this agent's remaining budget ${formatUnits6(budget)}.`,
      "Top up the buyer agent or raise its budget.",
    );
  }

  if (!target) {
    // An agent another server hosts: only public addresses, and only if it is registered on the ledger.
    try {
      assertPublicUrl(url);
    } catch (err) {
      throw new AppError(400, `${params.targetEnsName}'s endpoint is not reachable from here: ${(err as Error).message}`, "Its provider must publish a public PUBLIC_BASE_URL and run pnpm ens:sync.");
    }
    if (!(await isAgentRegistered(namehash(params.targetEnsName) as Hex))) {
      throw new AppError(404, `${params.targetEnsName} is not registered on the HireLedger.`);
    }
  }

  const hosts = [new URL(url).host];
  const payingFetch = createPayingFetch({
    accountId: params.buyer.hedera_account_id,
    privateKeyHex: decryptSecret(params.buyer.enc_private_key),
    maxUnits: budget,
    baseFetch: createSafeFetch(hosts, { hireId: params.parentHireId ?? undefined }),
  });

  let response: Response;
  try {
    response = await payingFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        input: params.input,
        translateTo: params.translateTo ?? null,
        buyerAgent: params.buyer.ens_name,
        consent: params.consent,
        parentHireId: params.parentHireId ?? null,
        arena: params.arena ?? false,
        taskId: params.taskId,
      }),
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/no.*(payment|requirement)|match/i.test(message)) {
      throw new AppError(402, "The agent's price is above this buyer's limit, so nothing was paid.", message);
    }
    throw new AppError(502, "Payment failed before the task ran.", message);
  }

  const text = await response.text();
  let body: { hireId?: string; result?: string; quotedPrice?: string; subHire?: SubHireOutcome | null; error?: string; hint?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (response.status === 503 && body.error === "agent_dormant") {
    throw new AppError(503, `${params.targetEnsName} is dormant, so nothing was paid.`, body.hint);
  }
  if (!response.ok || !body.hireId) {
    const hint = response.status === 402 ? "The facilitator rejected the payment. Run pnpm check-setup to check balances." : body.hint;
    throw new AppError(response.status === 402 ? 402 : 502, body.error ?? `Agent answered HTTP ${response.status}.`, hint);
  }

  const rawTx = settlementTxId(response);
  const paymentTxId = rawTx ? toMirrorTxId(rawTx) : null;
  if (paymentTxId && target) updateHire(body.hireId, { payment_tx_id: paymentTxId });
  if (params.maxUnits === undefined && params.buyer.kind === "buyer") {
    updateAgent(params.buyer.key, { budget_remaining: (budget - quote).toString() });
  }

  if (params.autoRate || params.fixedRating !== undefined) {
    const hireId = body.hireId;
    const result = body.result ?? "";
    void (async () => {
      const rating = params.fixedRating ?? (await judge(`Task for ${params.targetEnsName}`, result)).rating;
      if (target) {
        await submitRating({ hireId, rating, paymentTxId: paymentTxId ?? undefined });
        return;
      }
      // The hire lives on the seller's server: send it the rating, signed by the buyer agent's key.
      const account = privateKeyToAccount(`0x${decryptSecret(params.buyer.enc_private_key).replace(/^0x/, "")}`);
      const signature = await account.signMessage({ message: `${hireId}:${rating}:${paymentTxId ?? ""}` });
      await createSafeFetch(hosts)(`${new URL(url).origin}/api/hires/${encodeURIComponent(hireId)}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, paymentTxId: paymentTxId ?? undefined, signature }),
        signal: AbortSignal.timeout(30_000),
      });
    })().catch((err) => log.error("auto-rating failed", err));
  }

  return {
    hireId: body.hireId,
    result: body.result ?? "",
    quotedPrice: body.quotedPrice ?? formatUnits6(quote),
    paymentTxId,
    paymentUrl: paymentTxId ? hashscanTxUrl(paymentTxId) : null,
    subHire: body.subHire ?? null,
    discoveredVia: found.via,
  };
}

/** Starting budget for new buyer agents, in units. */
export function startingBudgetUnits(): bigint {
  return parseUnits6(config.hedera.buyerStartingUsdc);
}
