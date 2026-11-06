/**
 * x402 v2 on Hedera (exact scheme): the seller-side Express middleware with per-request prices and payees,
 * and the buyer-side fetch wrapper with a budget policy enforced in code (PRD PAY-1..7).
 */
import type { RequestHandler } from "express";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme as HederaClientScheme } from "@x402/hedera/exact/client";
import { ExactHederaScheme as HederaServerScheme } from "@x402/hedera/exact/server";
import { config } from "./config";
import { getAgentByLabel, type AgentRow } from "./db";
import { assetAmountToUnits, paymentAssetId, parseEcdsaKey, unitsToAssetAmount } from "./hedera";
import { getPrice } from "./ledger";

const NETWORK = config.hedera.caip2;

export function sellerLabelFromPath(path: string): string | null {
  const match = path.match(/^\/a\/([a-z0-9-]+)\/task\/?$/);
  return match ? match[1] : null;
}

function sellerFromPath(path: string): AgentRow {
  const label = sellerLabelFromPath(path);
  const agent = label ? getAgentByLabel(label) : undefined;
  if (!agent || agent.kind !== "seller") throw new Error(`No seller agent at ${path}`);
  return agent;
}

const priceCache = new Map<string, { units: bigint; at: number }>();

/** Current price in 6-decimal units: from the HireLedger (cached 2 s), falling back to the base price. */
export async function quoteUnits(agent: AgentRow): Promise<bigint> {
  const cached = priceCache.get(agent.key);
  if (cached && Date.now() - cached.at < 2000) return cached.units;
  let units = BigInt(agent.base_price);
  if (config.hedera.ledgerAddressOrNull() && agent.ledger_registered) {
    try {
      const onchain = await getPrice(agent.key as `0x${string}`);
      if (onchain > 0n) units = onchain;
    } catch {
      /* ledger unreachable: fall back to base price */
    }
  }
  priceCache.set(agent.key, { units, at: Date.now() });
  return units;
}

export function invalidatePrice(agentKey: string): void {
  priceCache.delete(agentKey);
}

/** Express middleware that answers 402 with a Hedera quote and settles through the facilitator. */
export function createSellerPaymentMiddleware(): RequestHandler {
  const facilitator = new HTTPFacilitatorClient({ url: config.hedera.facilitatorUrl });
  const decimals = config.hedera.paymentAsset === "USDC" ? 6 : 8;
  const resourceServer = new x402ResourceServer(facilitator).register(
    NETWORK,
    new HederaServerScheme({ defaultAssets: { [NETWORK]: { asset: paymentAssetId(), decimals } } }),
  );
  const routes = {
    "POST /a/:label/task": {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: (ctx: { path: string }) => sellerFromPath(ctx.path).hedera_account_id,
        price: async (ctx: { path: string }) => ({
          asset: paymentAssetId(),
          amount: unitsToAssetAmount(await quoteUnits(sellerFromPath(ctx.path))).toString(),
        }),
        maxTimeoutSeconds: 180,
      },
      description: `${config.appName} agent task`,
      mimeType: "application/json",
    },
  };
  return paymentMiddleware(routes as never, resourceServer) as unknown as RequestHandler;
}

export interface PayingFetchOptions {
  accountId: string;
  privateKeyHex: string;
  /** Max price per request, in 6-decimal units. Quotes above this abort before paying (PAY-7). */
  maxUnits: bigint;
  baseFetch?: typeof fetch;
}

export function createPayingFetch(options: PayingFetchOptions): typeof fetch {
  const signer = createClientHederaSigner(options.accountId, parseEcdsaKey(options.privateKeyHex), { network: NETWORK });
  const client = new x402Client().register("hedera:*", new HederaClientScheme(signer));
  client.registerPolicy((_version, requirements) =>
    requirements.filter((r) => r.network === NETWORK && assetAmountToUnits(BigInt(r.amount)) <= options.maxUnits),
  );
  return wrapFetchWithPayment(options.baseFetch ?? fetch, client) as typeof fetch;
}

/** Hedera transaction id from the x402 settlement header, if present. */
export function settlementTxId(response: Response): string | null {
  const header = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  try {
    const settle = decodePaymentResponseHeader(header);
    return settle.success && settle.transaction ? settle.transaction : null;
  } catch {
    return null;
  }
}

/** Checks the facilitator advertises hedera:testnet (PAY-4). */
export async function facilitatorSupportsHedera(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${config.hedera.facilitatorUrl}/supported`);
    if (!res.ok) return { ok: false, detail: `facilitator answered HTTP ${res.status}` };
    const body = (await res.json()) as { kinds?: { network?: string; scheme?: string; extra?: { feePayer?: string } }[] };
    const kind = body.kinds?.find((k) => k.network === NETWORK && k.scheme === "exact");
    return kind
      ? { ok: true, detail: `exact on ${NETWORK}, fee payer ${kind.extra?.feePayer ?? "?"}` }
      : { ok: false, detail: `facilitator does not list exact on ${NETWORK}` };
  } catch (err) {
    return { ok: false, detail: `could not reach facilitator: ${(err as Error).message}` };
  }
}
