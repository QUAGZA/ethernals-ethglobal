/**
 * Hire history rebuilt from the HireLedger `HireRecorded` event via the Hedera mirror node REST API.
 * Lets a server with an empty database show an agent's hires that were recorded by another server.
 * Cached for 60s with in-flight de-duplication; a hard 5s timeout returns stale/empty data instead of hanging.
 */
import { decodeEventLog, encodeEventTopics, type Hex } from "viem";
import { formatUnits6, hashscanEvmTxUrl, hireLedgerAbi, reasonFromIndex, type HireView } from "@ethernals/shared";
import { config } from "./config";

const FRESH_MS = 60_000;
const TIMEOUT_MS = 5_000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

const cache = new Map<string, { hires: HireView[]; at: number }>();
const inflight = new Map<string, Promise<HireView[]>>();

interface MirrorLog {
  data: string;
  topics: string[];
  transaction_hash: string;
  timestamp: string; // "seconds.nanos"
}

async function fetchHires(agentKey: string, signal: AbortSignal): Promise<HireView[]> {
  const address = config.hedera.ledgerAddressOrNull();
  if (!address) return [];
  const [topic0] = encodeEventTopics({ abi: hireLedgerAbi, eventName: "HireRecorded" });
  const out: HireView[] = [];
  let next: string | null =
    `/api/v1/contracts/${address}/results/logs?order=desc&limit=${PAGE_LIMIT}`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const res: Response = await fetch(`${config.hedera.mirrorUrl}${next}`, { signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`mirror ${res.status}`);
    const body = (await res.json()) as { logs?: MirrorLog[]; links?: { next?: string | null } };
    for (const log of body.logs ?? []) {
      // The mirror node only allows topic filters inside a 7-day timestamp window, so page the
      // (small) ledger log stream unfiltered and match topic0 / topic1 (agentKey) here.
      if (log.topics?.[0]?.toLowerCase() !== topic0 || log.topics?.[1]?.toLowerCase() !== agentKey) continue;
      try {
        const ev = decodeEventLog({
          abi: hireLedgerAbi,
          eventName: "HireRecorded",
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
        });
        const a = ev.args as unknown as {
          hireNo: bigint;
          paymentTxId: string;
          amountPaid: bigint;
          rating: number;
          counted: boolean;
          reason: number;
          parentHireRef: Hex;
        };
        const paid = formatUnits6(a.amountPaid);
        const hasParent = /[1-9a-f]/i.test(a.parentHireRef.slice(2));
        out.push({
          id: `chain-${a.hireNo.toString()}`,
          agentEnsName: "",
          buyerAgentEnsName: "on-chain",
          buyerHandle: "on-chain",
          quotedPrice: paid,
          paidAmount: paid,
          paymentTxId: a.paymentTxId || null,
          paymentUrl: null,
          rating: a.rating > 0 ? a.rating : null,
          status: "recorded",
          reason: reasonFromIndex(Number(a.reason)),
          counted: a.counted,
          ledgerTxHash: log.transaction_hash,
          ledgerUrl: hashscanEvmTxUrl(log.transaction_hash),
          ensTxHash: null,
          ensUrl: null,
          parentHireId: hasParent ? a.parentHireRef : null,
          createdAt: new Date(Number(log.timestamp.split(".")[0]) * 1000).toISOString(),
        });
      } catch {
        // skip logs we cannot decode
      }
    }
    next = body.links?.next ?? null;
  }
  return out;
}

export async function chainHiresFor(agentKey: string): Promise<HireView[]> {
  const key = agentKey.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.hires;

  let p = inflight.get(key);
  if (!p) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    p = fetchHires(key, ctl.signal)
      .then((hires) => {
        cache.set(key, { hires, at: Date.now() });
        return hires;
      })
      .catch(() => cache.get(key)?.hires ?? [])
      .finally(() => {
        clearTimeout(timer);
        inflight.delete(key);
      });
    inflight.set(key, p);
  }
  return p;
}
