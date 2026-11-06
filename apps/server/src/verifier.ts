/**
 * The verifier: confirms the payment on Hedera's mirror node, resolves who the buyer is, computes the
 * per-agent person hashes and hands the hire to the HireLedger, whose contract decides if it counts (PRD §8.4).
 */
import { keccak256, stringToHex, type Hex } from "viem";
import {
  formatScore,
  formatUnits6,
  hashscanEvmTxUrl,
  hashscanTxUrl,
  isCountedReason,
  toMirrorTxId,
  type Reason,
} from "@ethernals/shared";
import { personHash } from "./crypto";
import { getAgent, getHire, getMandateForHire, getPerson, listStaleUnratedHires, updateHire, type HireRow } from "./db";
import { AppError } from "./errors";
import { emit, log } from "./events";
import { queueReputationUpdate, queueTotalsUpdate } from "./ens";
import { verifyPaymentOnMirror } from "./hedera";
import { isPersonCredentialValid } from "./identity";
import { paymentRef, recordHire, ZERO_HASH } from "./ledger";
import { invalidatePrice } from "./payments";

const inFlight = new Set<string>();

export function consentHash(hireId: string): Hex {
  const mandate = getMandateForHire(hireId);
  if (!mandate) return ZERO_HASH;
  return keccak256(stringToHex(JSON.stringify({ hireId, forward: mandate.forward === 1, subBudget: mandate.sub_budget })));
}

/**
 * Accepts a rating (0 = none, after the timeout) and records the hire on the ledger in the background.
 * Returns immediately with the hire in status "rated"; the outcome arrives as a `hire.recorded` event.
 */
export async function submitRating(params: { hireId: string; rating: number; paymentTxId?: string }): Promise<HireRow> {
  const hire = getHire(params.hireId);
  if (!hire) throw new AppError(404, "Unknown hire.");
  if (hire.status === "recorded" || hire.status === "rated" || inFlight.has(hire.id)) return hire;
  if (!Number.isInteger(params.rating) || params.rating < 0 || params.rating > 5) {
    throw new AppError(400, "Rating must be a whole number from 1 to 5.");
  }

  let txId = hire.payment_tx_id;
  if (!txId && params.paymentTxId) {
    txId = toMirrorTxId(params.paymentTxId);
    updateHire(hire.id, { payment_tx_id: txId });
  }
  if (!txId) throw new AppError(409, "This hire has no payment yet, so it cannot be rated.");

  const updated = updateHire(hire.id, { rating: params.rating, rated_at: new Date().toISOString(), status: "rated" });
  emit("hire.rated", { hireId: hire.id, message: `Rating ${params.rating} received` });
  inFlight.add(hire.id);
  void processHire(hire.id).finally(() => inFlight.delete(hire.id));
  return updated;
}

async function processHire(hireId: string): Promise<void> {
  const hire = getHire(hireId)!;
  const seller = getAgent(hire.agent_key)!;
  const buyer = getAgent(hire.buyer_agent_key)!;
  const txId = hire.payment_tx_id!;

  try {
    const payment = await verifyPaymentOnMirror({
      txId,
      payer: buyer.hedera_account_id,
      payee: seller.hedera_account_id,
      minUnits: BigInt(hire.quoted_price),
    });
    if (!payment.ok) {
      updateHire(hire.id, { status: "payment_not_verified", reason: "PAYMENT_NOT_VERIFIED", counted: 0 });
      emit("hire.payment_not_verified", {
        hireId,
        agentEnsName: seller.ens_name,
        reason: "PAYMENT_NOT_VERIFIED",
        message: payment.reason,
        paymentUrl: hashscanTxUrl(txId),
      });
      return;
    }
    updateHire(hire.id, { paid_amount: payment.amountUnits!.toString() });

    const buyerPerson = getPerson(buyer.person_id);
    const verified = buyerPerson ? await isPersonCredentialValid(buyerPerson, buyer) : false;
    const buyerHash = verified && buyerPerson ? personHash(buyerPerson.id, seller.key) : ZERO_HASH;

    const outcome = await recordHire({
      agentKey: seller.key as Hex,
      buyerPersonHash: buyerHash,
      paymentRef: paymentRef(txId),
      paymentTxId: txId,
      amountPaid: payment.amountUnits!,
      rating: hire.rating ?? 0,
      consentHash: consentHash(hire.id),
      parentHireRef: hire.parent_hire_id ? keccak256(stringToHex(hire.parent_hire_id)) : ZERO_HASH,
    });

    const reason: Reason = outcome.reason;
    updateHire(hire.id, {
      status: "recorded",
      reason,
      counted: outcome.counted ? 1 : 0,
      ledger_tx_hash: outcome.txHash,
    });
    invalidatePrice(seller.key);

    const score = formatScore(outcome.scoreX1e6);
    const price = formatUnits6(outcome.price);
    emit("hire.recorded", {
      hireId,
      agentEnsName: seller.ens_name,
      buyerAgentEnsName: buyer.ens_name,
      reason,
      counted: outcome.counted,
      score,
      price,
      arena: hire.arena === 1,
      paymentUrl: hashscanTxUrl(txId),
      ledgerUrl: hashscanEvmTxUrl(outcome.txHash),
      message: `${seller.ens_name}: ${reason}${outcome.counted ? ` → score ${score}, price ${price}` : ""}`,
    });

    if (isCountedReason(reason)) {
      queueReputationUpdate(seller, hire.id);
    }
    queueTotalsUpdate(seller);
  } catch (err) {
    log.error(`could not record hire ${hireId}`, err);
    updateHire(hire.id, { status: "delivered" }); // allow a retry
    emit("info", { hireId, message: `Recording failed, will retry: ${(err as Error).message}` });
  }
}

/** Unrated hires older than 10 minutes are recorded as NO_RATING (PRD R6). */
export function startUnratedSweeper(): NodeJS.Timeout {
  return setInterval(() => {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    for (const hire of listStaleUnratedHires(cutoff)) {
      submitRating({ hireId: hire.id, rating: 0 }).catch((err) => log.error("sweeper failed", err));
    }
  }, 60_000);
}
