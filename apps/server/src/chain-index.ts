/**
 * Chain-sourced agent index: no database is the source of truth for which agents exist.
 *
 *  1. Scan the parent name's ENS resolver for NamedResource events. Each carries the DNS-encoded name the first time
 *     records are written for it, so every `label.<parent>` is discoverable without a list.
 *  2. Keep a name only if its namehash is registered in the HireLedger on Hedera.
 *  3. Read its public records from ENS (endpoint, description, provider, brain, ...) and probe the endpoint.
 *
 * The result is a cache (chain_agents) that any server can rebuild from scratch. Reputation (score, price, votes) is
 * read from the ledger when a page is built, never copied here.
 */
import { createPublicClient, decodeAbiParameters, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";
import { assertPublicUrl } from "./agent-tools";
import { config } from "./config";
import { getAgentByEnsName, kvGet, kvSet, listChainAgents, upsertChainAgent, type ChainAgentRow } from "./db";
import { readText } from "./ens";
import { log } from "./events";
import { isAgentRegistered } from "./ledger";
import { ENS_KEYS } from "@ethernals/shared";

/** keccak of the resolver's NamedResource(uint256,bytes) event: data holds the DNS-encoded name. */
const NAMED_RESOURCE_TOPIC = "0x66fd1d4edf16fc35ee08adaecfdf6fd5f75283da903b50f642558d6e0ba630ff";
const KV_BLOCK = "chainindex.ens.block";
const KV_DEPLOY = "chainindex.ens.deploy";
const PASS_EVERY_MS = 60_000;
const RECORDS_TTL_MS = 10 * 60_000;
const PROBE_TTL_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 4_000;

/** The configured (archive) RPC first, then the public one, which prunes old history. */
function clients() {
  const urls: string[] = [];
  try {
    urls.push(config.sepolia.rpcUrl());
  } catch {
    /* no private RPC configured */
  }
  urls.push(config.sepolia.publicRpcUrl);
  return urls.map((url) => createPublicClient({ chain: sepolia, transport: http(url, { timeout: 30_000 }) }));
}
type Client = ReturnType<typeof clients>[number];

async function firstOk<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const c of clients()) {
    try {
      return await fn(c);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

interface RpcLog {
  data: Hex;
  blockNumber: Hex;
}

/** DNS wire format (length-prefixed labels) to a dotted name. */
export function dnsDecode(bytes: Hex): string {
  const raw = Buffer.from(bytes.slice(2), "hex");
  const labels: string[] = [];
  for (let i = 0; i < raw.length && raw[i] !== 0; ) {
    const len = raw[i]!;
    labels.push(raw.subarray(i + 1, i + 1 + len).toString("utf8"));
    i += len + 1;
  }
  return labels.join(".");
}

/** The block the resolver was deployed in, found by binary search on its code; falls back to ~45 days back. */
async function deployBlock(head: bigint): Promise<bigint> {
  const cached = kvGet<string>(KV_DEPLOY);
  if (cached) return BigInt(cached);
  const address = process.env.ENS_RESOLVER_ADDRESS as Hex | undefined;
  if (!address) return head > 300_000n ? head - 300_000n : 0n;
  try {
    let lo = 0n;
    let hi = head;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const code = await firstOk((c) => c.getCode({ address, blockNumber: mid }));
      if (code && code !== "0x") hi = mid;
      else lo = mid + 1n;
    }
    kvSet(KV_DEPLOY, lo.toString());
    return lo;
  } catch {
    return head > 300_000n ? head - 300_000n : 0n;
  }
}

async function getLogs(address: Hex, from: bigint, to: bigint): Promise<RpcLog[]> {
  return (await firstOk((c) =>
    c.request({
      method: "eth_getLogs",
      params: [{ address, topics: [NAMED_RESOURCE_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
    } as never),
  )) as unknown as RpcLog[];
}

/** New names since the last pass, scanning in chunks that shrink when the RPC refuses a range. */
async function scanNames(): Promise<string[]> {
  const address = process.env.ENS_RESOLVER_ADDRESS as Hex | undefined;
  if (!address) return [];
  const head = await firstOk((c) => c.getBlockNumber());
  const saved = kvGet<string>(KV_BLOCK);
  let from = saved ? BigInt(saved) + 1n : await deployBlock(head);
  const names: string[] = [];
  let chunk = 50_000n;
  while (from <= head) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n;
    try {
      for (const entry of await getLogs(address, from, to)) {
        const [bytes] = decodeAbiParameters([{ type: "bytes" }], entry.data);
        names.push(dnsDecode(bytes as Hex));
      }
      kvSet(KV_BLOCK, to.toString());
      from = to + 1n;
    } catch (err) {
      if (chunk > 500n) {
        chunk /= 2n;
      } else if (/pruned|history/i.test((err as Error).message)) {
        log.warn("chain index: skipping history this RPC no longer has", { from: from.toString() });
        kvSet(KV_BLOCK, to.toString());
        from = to + 1n;
      } else {
        throw err;
      }
    }
  }
  return names;
}

/** Task type from the capability or context records. */
function taskTypeOf(capabilities: string | null, context: string | null): string | null {
  const text = `${capabilities ?? ""} ${context ?? ""}`;
  if (text.includes("code-fix")) return "code-fix";
  if (text.includes("image-gen")) return "image-gen";
  if (text.includes("video-gen")) return "video-gen";
  if (/^\s*translate|translate ·/.test(text)) return "translate";
  if (/summarize/.test(text)) return "summarize";
  return null;
}

async function readRecords(name: string) {
  const [description, endpoint, provider, context, brain, capabilities, hedera, label] = await Promise.all(
    [
      ENS_KEYS.description,
      ENS_KEYS.endpoint,
      ENS_KEYS.provider,
      ENS_KEYS.context,
      ENS_KEYS.brain,
      ENS_KEYS.capabilities,
      ENS_KEYS.hedera,
      ENS_KEYS.label,
    ].map((k) => readText(name, k).catch(() => null)),
  );
  return { description, endpoint, provider, brain, hedera, label, taskType: taskTypeOf(capabilities, context) };
}

async function probe(endpoint: string | null): Promise<ChainAgentRow["status"]> {
  if (!endpoint) return "unknown";
  try {
    assertPublicUrl(endpoint);
  } catch {
    return "private";
  }
  try {
    const res = await fetch(endpoint, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel();
    return res.status < 500 ? "online" : "offline";
  } catch {
    return "offline";
  }
}

async function indexName(rawName: string, parent: string): Promise<void> {
  let name: string;
  try {
    name = normalize(rawName);
  } catch {
    return;
  }
  const suffix = `.${parent}`;
  if (!name.endsWith(suffix)) return;
  const label = name.slice(0, -suffix.length);
  if (!label || label.includes(".")) return; // only direct subnames
  if (getAgentByEnsName(name)) return; // this server owns it; it is listed from the local database
  const key = namehash(name) as Hex;
  if (!(await isAgentRegistered(key))) return; // buyers and unregistered names are not for hire
  const records = await readRecords(name);
  upsertChainAgent({
    name,
    label,
    key,
    description: records.description ?? "",
    endpoint: records.endpoint,
    provider: records.provider,
    task_type: records.taskType,
    brain: records.brain,
    hedera_account: records.hedera,
    status: await probe(records.endpoint),
    records_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
  });
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await fn(item).catch((err) => log.warn("chain index: item failed", { error: (err as Error).message }));
      }
    }),
  );
}

let running = false;

/** One pass: discover new names, refresh stale records, re-probe endpoints. Safe to call at any time. */
export async function runIndexPass(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const parent = config.ens.parentOrNull();
    if (!parent || !config.hedera.ledgerAddressOrNull()) return;
    const parentName = normalize(parent);
    const fresh = [...new Set(await scanNames())];
    await mapLimit(fresh, 4, (n) => indexName(n, parentName));

    const now = Date.now();
    await mapLimit(listChainAgents(), 4, async (row) => {
      if (getAgentByEnsName(row.name)) return;
      if (now - Date.parse(row.records_at) > RECORDS_TTL_MS) {
        await indexName(row.name, parentName);
      } else if (now - Date.parse(row.checked_at) > PROBE_TTL_MS) {
        upsertChainAgent({ ...row, status: await probe(row.endpoint), checked_at: new Date().toISOString() });
      }
    });
  } catch (err) {
    log.warn("chain index pass failed", { error: (err as Error).message });
  } finally {
    running = false;
  }
}

export function startChainIndexer(): void {
  if (process.env.CHAIN_INDEX === "false") return;
  void runIndexPass();
  setInterval(() => void runIndexPass(), PASS_EVERY_MS).unref();
}
