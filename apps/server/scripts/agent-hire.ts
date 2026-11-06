/**
 * pnpm agent:hire --as <buyer-agent-label> --agent <ens-name> --input <file|text>
 *                 [--translate-to hi] [--forward] [--sub-budget 0.05] [--min-score 0] [--max-price 0.2]
 *
 * An autonomous buyer agent (PRD F4): it discovers the seller in ENS, checks its policy, pays over x402 on
 * Hedera, judges the result with an LLM and submits a signed rating — no human approval anywhere.
 * Needs `pnpm dev` running (the server records the hire on the HireLedger).
 */
import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits6, hashscanTxUrl, parseUnits6, REASON_LABELS, toMirrorTxId, type HireView } from "@ethernals/shared";
import { config, normalizeEcdsaKey, ROOT_DIR } from "../src/config";
import { decryptSecret } from "../src/crypto";
import { getAgentByEnsName, getAgentByLabel, updateAgent } from "../src/db";
import { readAgentRecords } from "../src/ens";
import { judge } from "../src/llm";
import { createPayingFetch, settlementTxId } from "../src/payments";
import { createSafeFetch } from "../src/sandbox";
import { bad, info, ok, parseArgs, run, title, warn } from "./_cli";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

run(async () => {
  const { flags } = parseArgs();
  const as = String(flags.as ?? "");
  const target = String(flags.agent ?? "");
  const inputArg = String(flags.input ?? "");
  if (!as || !target || !inputArg) {
    throw new Error("Usage: pnpm agent:hire --as bob-buyer --agent summarize.<your ENS name> --input demo/sample.txt");
  }
  const buyer = getAgentByLabel(as) ?? getAgentByEnsName(as);
  if (!buyer) throw new Error(`No agent "${as}". Your buyer agent is "<handle>-buyer" (see /me).`);

  const inputPath = [path.resolve(process.cwd(), inputArg), path.resolve(ROOT_DIR, inputArg)].find((p) => fs.existsSync(p));
  const input = inputPath ? fs.readFileSync(inputPath, "utf8") : inputArg;
  const ensName = target.includes(".") ? target : `${target}.${config.ens.parent()}`;

  const server = config.internalBaseUrl;
  const health = await fetch(`${server}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`The server is not running at ${server}. Start it with: pnpm dev`);

  title(`Buyer agent ${buyer.ens_name} → ${ensName}`);
  const records = await readAgentRecords(ensName);
  info(`ENS says: endpoint ${records.endpoint ?? "—"} · price ${records.price ?? "—"} · score ${records.score ?? "—"} · votes ${records.votes ?? "—"}`);
  if (!records.endpoint) throw new Error(`${ensName} has no x402 endpoint in ENS. Run pnpm ens:sync, or check the name.`);

  const minScore = flags["min-score"] ? Number(flags["min-score"]) : 0;
  if (records.score && Number(records.score) < minScore) throw new Error(`Score ${records.score} is below --min-score ${minScore}. Not hiring.`);
  const maxUnits = flags["max-price"] ? parseUnits6(String(flags["max-price"])) : BigInt(buyer.budget_remaining);
  if (records.price && parseUnits6(records.price) > maxUnits) {
    throw new Error(`Price ${records.price} is above the limit ${formatUnits6(maxUnits)}. Not paying.`);
  }
  ok(`Policy passed (min score ${minScore}, max price ${formatUnits6(maxUnits)})`);

  // Agents hosted by this server can be reached directly if the public URL isn't reachable from here.
  const local = getAgentByEnsName(ensName);
  const endpoints = [records.endpoint, ...(local ? [`${server}/a/${local.label}/task`] : [])];
  const privateKeyHex = decryptSecret(buyer.enc_private_key);

  let response: Response | null = null;
  for (const url of endpoints) {
    try {
      const payingFetch = createPayingFetch({
        accountId: buyer.hedera_account_id,
        privateKeyHex,
        maxUnits,
        baseFetch: createSafeFetch([new URL(url).host]),
      });
      info(`Calling ${url} (x402 on Hedera)...`);
      response = await payingFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          input,
          translateTo: flags["translate-to"] ? String(flags["translate-to"]) : null,
          buyerAgent: buyer.ens_name,
          consent: { forward: Boolean(flags.forward), subBudget: flags["sub-budget"] ? String(flags["sub-budget"]) : "0" },
        }),
      });
      break;
    } catch (err) {
      warn(`${url} failed: ${(err as Error).message}`);
    }
  }
  if (!response) throw new Error("Could not reach the agent.");
  const body = (await response.json().catch(() => ({}))) as {
    hireId?: string;
    result?: string;
    quotedPrice?: string;
    subHire?: { status: string; reason?: string; agentEnsName?: string; paymentUrl?: string | null } | null;
    error?: string;
  };
  if (!response.ok || !body.hireId) throw new Error(body.error ?? `Agent answered HTTP ${response.status}`);

  const rawTx = settlementTxId(response);
  const paymentTxId = rawTx ? toMirrorTxId(rawTx) : null;
  ok(`Paid ${body.quotedPrice} ${config.hedera.paymentAsset} — ${paymentTxId ? hashscanTxUrl(paymentTxId) : "(no settlement header)"}`);
  if (!flags["max-price"]) updateAgent(buyer.key, { budget_remaining: (BigInt(buyer.budget_remaining) - parseUnits6(body.quotedPrice ?? "0")).toString() });
  if (body.subHire) {
    const s = body.subHire;
    s.status === "blocked" ? warn(`Sub-hire BLOCKED: ${REASON_LABELS[s.reason as keyof typeof REASON_LABELS] ?? s.reason}`) : info(`Sub-hire ${s.status}: ${s.agentEnsName ?? ""} ${s.paymentUrl ?? ""}`);
  }
  console.log(`\n${body.result}\n`);

  const verdict = await judge(`Task for ${ensName}`, body.result ?? "");
  ok(`LLM judge: ${verdict.rating}/5 — ${verdict.reason}`);
  const account = privateKeyToAccount(normalizeEcdsaKey(privateKeyHex));
  const signature = await account.signMessage({ message: `${body.hireId}:${verdict.rating}:${paymentTxId ?? ""}` });
  const rate = await fetch(`${server}/api/hires/${body.hireId}/rate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rating: verdict.rating, signature, paymentTxId: paymentTxId ?? undefined }),
  });
  if (!rate.ok) throw new Error(`Rating was refused: ${(await rate.json().catch(() => ({}))).error ?? rate.status}`);
  info("Rating submitted; waiting for the HireLedger...");

  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const hire = (await (await fetch(`${server}/api/hires/${body.hireId}`)).json()) as HireView;
    if (hire.status === "recorded") {
      (hire.counted ? ok : warn)(`${hire.reason}: ${REASON_LABELS[hire.reason!]}`);
      info(`Payment: ${hire.paymentUrl}`);
      info(`Ledger:  ${hire.ledgerUrl}`);
      return;
    }
    if (hire.status === "payment_not_verified") {
      bad("The verifier could not confirm the payment on Hedera's mirror node.");
      return;
    }
  }
  warn("Still recording — check the agent page in a minute.");
});
