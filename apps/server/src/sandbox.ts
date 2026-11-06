/**
 * The software side of the data promise (PRD §12):
 *  - SEC-1 a fresh workspace per hire, always deleted afterwards;
 *  - SEC-3 an outbound allowlist for everything the agent runtime fetches.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "./config";
import { emit, log } from "./events";

export class EgressBlockedError extends Error {
  constructor(public readonly host: string) {
    super(`Outbound request to ${host} blocked: it is not on this hire's allowlist.`);
    this.name = "EgressBlockedError";
  }
}

/** Hosts every hire may reach: the LLM API, the x402 facilitator, Hedera's mirror node and this server. */
export function baseAllowedHosts(): string[] {
  const hosts = new Set<string>(["api.anthropic.com"]);
  for (const url of [config.hedera.facilitatorUrl, config.hedera.mirrorUrl, config.internalBaseUrl]) {
    try {
      hosts.add(new URL(url).host);
    } catch {
      /* ignore malformed */
    }
  }
  return [...hosts];
}

/** Returns a fetch that only reaches allowlisted hosts; anything else throws and is logged as EGRESS_BLOCKED. */
export function createSafeFetch(extraHosts: string[] = [], context: { hireId?: string } = {}): typeof fetch {
  const allowed = new Set([...baseAllowedHosts(), ...extraHosts]);
  const safeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!allowed.has(url.host)) {
      emit("egress.blocked", { hireId: context.hireId, message: `Blocked outbound request to ${url.host}`, reason: "EGRESS_BLOCKED" });
      log.warn("egress blocked", { host: url.host, hireId: context.hireId });
      throw new EgressBlockedError(url.host);
    }
    return fetch(input, init);
  }) as typeof fetch;
  return safeFetch;
}

/** Runs `fn` inside a fresh per-hire directory that is deleted afterwards, on success or failure. */
export async function withWorkspace<T>(hireId: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const base = path.join(os.tmpdir(), "ethernals");
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, `${hireId}-`));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
