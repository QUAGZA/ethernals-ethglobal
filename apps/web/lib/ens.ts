/**
 * Reads agent records straight from ENS on Sepolia, in the browser (PRD ENS-4).
 * Nothing here goes through our server: a judge can check the same values in the ENS app.
 * ENSv2 is live on Sepolia; viem >= 2.35 resolves it through the Universal Resolver.
 */
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import type { PublicConfig } from "@ethernals/shared";

type EnsConfig = Pick<PublicConfig, "sepoliaRpcUrl" | "ensUniversalResolver">;

const makeClient = (rpcUrl: string) =>
  createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 12_000, retryCount: 1 }) });

const clients = new Map<string, ReturnType<typeof makeClient>>();

function clientFor(rpcUrl: string) {
  let client = clients.get(rpcUrl);
  if (!client) {
    client = makeClient(rpcUrl);
    clients.set(rpcUrl, client);
  }
  return client;
}

export interface EnsReadResult {
  /** key -> value; null when the record is not set. Keys that failed to read are absent. */
  values: Record<string, string | null>;
  /** Keys whose read failed (RPC error), with the first error message. */
  failedKeys: string[];
  error: string | null;
  readAt: Date;
}

function shortError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  return (e?.shortMessage || e?.message || String(err)).split("\n")[0];
}

/**
 * Reads the given text records for `ensName`. Throws when ENS cannot be reached at all,
 * so the UI can say so instead of silently showing something else.
 */
export async function readEnsTextRecords(ensName: string, keys: string[], config: EnsConfig): Promise<EnsReadResult> {
  if (!config.sepoliaRpcUrl) throw new Error("The server did not provide a Sepolia RPC URL (SEPOLIA_RPC_URL), so ENS cannot be read.");
  const client = clientFor(config.sepoliaRpcUrl);
  const name = normalize(ensName);
  const resolver = config.ensUniversalResolver
    ? { universalResolverAddress: config.ensUniversalResolver as Address }
    : {};

  const results = await Promise.allSettled(keys.map((key) => client.getEnsText({ name, key, ...resolver })));

  const values: Record<string, string | null> = {};
  const failedKeys: string[] = [];
  let firstError: unknown = null;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      values[keys[i]] = result.value && result.value.length > 0 ? result.value : null;
    } else {
      failedKeys.push(keys[i]);
      firstError ??= result.reason;
    }
  });

  if (keys.length > 0 && failedKeys.length === keys.length) {
    throw new Error(`Could not read ENS on Sepolia: ${shortError(firstError)}`);
  }
  return { values, failedKeys, error: firstError ? shortError(firstError) : null, readAt: new Date() };
}

/** Host name of the RPC, for the "read from" line. */
export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
}
