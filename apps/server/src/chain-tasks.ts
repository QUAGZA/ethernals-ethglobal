/**
 * Read-only, chain-sourced task listing for the TaskEscrow on Ethereum Sepolia.
 *  - Task state (client, specialist, bounty, deadline, status, hashes) comes from taskCount + getTask(), which every RPC
 *    serves because it is current state.
 *  - Tx hashes per step come from replaying the escrow events (TaskCreated/TaskAccepted/ResultSubmitted/TaskSettled/
 *    TaskRefunded). eth_getLogs history is limited on the free RPCs (public node ~ the last few thousand blocks, Alchemy
 *    free 10 blocks), so tx hashes are best effort unless TASK_ESCROW_DEPLOY_BLOCK is set and an archive RPC is configured.
 * Spec and patch content is off-chain (only hashes and URIs are emitted).
 * Cached 60 s, de-duplicated while in flight, and bounded by a hard timeout that returns stale/empty data.
 */
import { createPublicClient, decodeEventLog, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { ESCROW_STATUS, formatUnits6, taskEscrowAbi, type ChainTask } from "@ethernals/shared";
import { config } from "./config";
import { log } from "./events";

const TTL_MS = 60_000;
const HARD_TIMEOUT_MS = 20_000;
const LOOKBACK_BLOCKS = 10_000n;
const MAX_TASKS = 200;
const LOG_BUDGET_MS = 12_000;

function clients() {
  const urls: string[] = [];
  try {
    urls.push(config.sepolia.rpcUrl());
  } catch {
    /* no private RPC configured */
  }
  urls.push(config.sepolia.publicRpcUrl);
  return urls.map((url) => createPublicClient({ chain: sepolia, transport: http(url, { timeout: 15_000 }) }));
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
  topics: Hex[];
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
}

async function getLogs(address: Hex, from: bigint, to: bigint): Promise<RpcLog[]> {
  return (await firstOk((c) =>
    c.request({
      method: "eth_getLogs",
      params: [{ address, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
    } as never),
  )) as unknown as RpcLog[];
}

/** Logs already read (kept in memory so refreshes only scan new blocks) and the next block to read. */
const seen = new Map<string, RpcLog>();
let nextFrom: bigint | null = null;
/** Largest range the RPCs accepted so far; shrinks on range errors and is remembered across passes. */
let chunk = 5_000n;
const PARALLEL = 1; // public RPCs rate-limit parallel getLogs (HTTP 429)

async function scanLogs(address: Hex): Promise<RpcLog[]> {
  const head = await firstOk((c) => c.getBlockNumber());
  if (nextFrom === null) {
    const override = process.env.TASK_ESCROW_DEPLOY_BLOCK;
    nextFrom = override ? BigInt(override) : head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
  }
  const started = Date.now();
  while (nextFrom <= head && Date.now() - started < LOG_BUDGET_MS) {
    const ranges: [bigint, bigint][] = [];
    for (let from = nextFrom; from <= head && ranges.length < PARALLEL; from += chunk) {
      ranges.push([from, from + chunk - 1n > head ? head : from + chunk - 1n]);
    }
    const results = await Promise.allSettled(ranges.map(([f, t]) => getLogs(address, f, t)));
    let done = 0;
    for (let i = 0; i < results.length; i++) {
      const res = results[i]!;
      if (res.status === "rejected") {
        if (/429|rate limit/i.test((res.reason as Error).message)) await new Promise((r) => setTimeout(r, 1_500));
        else if (chunk > 500n) chunk /= 2n;
        else if (/pruned|history/i.test((res.reason as Error).message)) done = i + 1;
        else {
          log.warn("chain tasks: log history unavailable, tx hashes may be missing", { error: (res.reason as Error).message.slice(0, 120) });
          nextFrom = head + 1n; // give up on this window; state reads below still work
        }
        break;
      }
      for (const e of res.value) seen.set(`${e.transactionHash}:${e.logIndex}`, e);
      done = i + 1;
    }
    if (done > 0 && nextFrom <= head) nextFrom = ranges[done - 1]![1] + 1n;
  }
  return [...seen.values()];
}

function blank(id: string): ChainTask {
  return {
    chainTaskId: id,
    client: "0x0000000000000000000000000000000000000000",
    specialist: null,
    bounty: "0.000000",
    status: "Open",
    deadline: 0,
    specHash: null,
    testsHash: null,
    patchHash: null,
    resultHash: null,
    passed: null,
    txs: { created: null, accepted: null, submitted: null, settled: null, refunded: null },
  };
}

const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function build(): Promise<ChainTask[]> {
  const address = config.escrow.addressOrNull();
  if (!address) return [];
  const logs = await scanLogs(address).catch(() => [] as RpcLog[]);
  logs.sort((a, b) => {
    const d = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return d !== 0n ? (d < 0n ? -1 : 1) : Number(BigInt(a.logIndex) - BigInt(b.logIndex));
  });
  const tasks = new Map<string, ChainTask>();
  const count = Number(await firstOk((c) => c.readContract({ address, abi: taskEscrowAbi, functionName: "taskCount" })));
  const ids: number[] = [];
  for (let id = count; id >= 1 && ids.length < MAX_TASKS; id--) ids.push(id);
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(
      ids.slice(i, i + 8).map(async (id) => {
        const st = await firstOk((c) => c.readContract({ address, abi: taskEscrowAbi, functionName: "getTask", args: [BigInt(id)] }));
        const t = blank(String(id));
        t.client = st.client;
        t.specialist = st.specialist === ZERO ? null : st.specialist;
        t.bounty = formatUnits6(st.bounty);
        t.status = ESCROW_STATUS[st.status] ?? "None";
        t.deadline = Number(st.deadline);
        t.specHash = st.specHash;
        t.testsHash = st.testsHash;
        t.patchHash = st.patchHash === ZERO_HASH ? null : st.patchHash;
        t.resultHash = st.resultHash === ZERO_HASH ? null : st.resultHash;
        if (t.status === "Passed") t.passed = true;
        if (t.status === "Failed") t.passed = false;
        tasks.set(t.chainTaskId, t);
      }),
    );
  }
  // Events add the tx hash of each step; they never override the state read above.
  const get = (id: bigint) => tasks.get(id.toString());
  for (const entry of logs) {
    let ev;
    try {
      ev = decodeEventLog({ abi: taskEscrowAbi, data: entry.data, topics: entry.topics as [Hex, ...Hex[]] });
    } catch {
      continue; // not a task event (e.g. ownership or settler changes)
    }
    const a = ev.args as Record<string, any>;
    if (a.taskId === undefined) continue;
    const t = get(a.taskId);
    if (!t) continue;
    const tx = entry.transactionHash;
    const step = { TaskCreated: "created", TaskAccepted: "accepted", ResultSubmitted: "submitted", TaskSettled: "settled", TaskRefunded: "refunded" } as const;
    const key = step[ev.eventName as keyof typeof step];
    if (key) t.txs[key] = tx;
  }
  return [...tasks.values()].sort((x, y) => Number(BigInt(y.chainTaskId) - BigInt(x.chainTaskId)));
}

let cache: { at: number; tasks: ChainTask[] } | null = null;
let inflight: Promise<ChainTask[]> | null = null;

export function chainTasks(): Promise<ChainTask[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.tasks);
  if (!inflight) {
    inflight = build()
      .then((tasks) => {
        cache = { at: Date.now(), tasks };
        return tasks;
      })
      .catch((err) => {
        log.warn("chain tasks: scan failed", { error: (err as Error).message });
        return cache?.tasks ?? [];
      })
      .finally(() => {
        inflight = null;
      });
  }
  const timeout = new Promise<ChainTask[]>((resolve) => setTimeout(() => resolve(cache?.tasks ?? []), HARD_TIMEOUT_MS).unref?.());
  return Promise.race([inflight, timeout]);
}
