/**
 * World ID (IDKit v4 / World ID 4.0) and the optional AgentBook ("Agent Pass" / AgentKit) check.
 *
 *  - The backend signs every IDKit request (RP signature) and verifies proofs at
 *    POST https://developer.world.org/api/v4/verify/{rp_id} with the IDKit result forwarded unchanged.
 *  - The nullifier is stable per (person, app, action), so a UNIQUE column blocks a second sign-up.
 *  - HUMAN_MODE=agentkit additionally requires each buyer agent's wallet to be registered in World's AgentBook
 *    (World Chain). Two wallets backed by the same human share one humanId.
 */
import { signRequest } from "@worldcoin/idkit-core/signing";
import { createPublicClient, http, parseAbi } from "viem";
import { worldchain } from "viem/chains";
import { config, ConfigError } from "./config";
import type { AgentRow, PersonRow } from "./db";
import { AppError } from "./errors";
import { log } from "./events";

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** Signed request context the IDKit widget needs (never sign on the client). */
export function createRpContext(): RpContext {
  const rpId = config.world.rpId;
  const key = config.world.rpSigningKey;
  if (!rpId) throw new ConfigError("WORLD_RP_ID", "Copy the RP ID from developer.world.org (SETUP.md, Step 7b).");
  if (!key) throw new ConfigError("WORLD_RP_SIGNING_KEY", "Copy the signing key from developer.world.org (SETUP.md, Step 7b).");
  const signed = signRequest({ signingKeyHex: key, action: config.world.action, ttl: 300 });
  return { rp_id: rpId, nonce: signed.nonce, created_at: signed.createdAt, expires_at: signed.expiresAt, signature: signed.sig };
}

interface IdkitResponseItem {
  identifier?: string;
  nullifier?: string;
}
interface IdkitResult {
  protocol_version?: string;
  action?: string;
  environment?: string;
  responses?: IdkitResponseItem[];
}
interface VerifyResponse {
  success?: boolean;
  nullifier?: string;
  environment?: string;
  action?: string;
  code?: string;
  detail?: string;
  results?: { identifier?: string; success?: boolean; nullifier?: string; code?: string; detail?: string }[];
}

/** Normalizes a nullifier (hex or decimal) to a decimal string so the same person always maps to one value. */
export function normalizeNullifier(value: string): string {
  return BigInt(value.trim()).toString(10);
}

const HINTS: Record<string, string> = {
  invalid_proof: "Usually a staging/production mix-up: a staging app must be used with the World ID Simulator.",
  verification_failed: "World could not verify the proof. Try again.",
  not_registered: "World is still registering your app. Wait a few minutes and retry.",
  app_not_migrated: "Your World app must be migrated to World ID 4.0 in the Developer Portal.",
  all_verifications_failed: "World rejected the proof. Check that WORLD_ENV matches the app's environment.",
};

/** Verifies an IDKit result with World and returns the person's stable nullifier for our action. */
export async function verifyWorldProof(result: unknown): Promise<{ nullifier: string; environment: string }> {
  const proof = result as IdkitResult;
  if (!proof || typeof proof !== "object" || !Array.isArray(proof.responses)) {
    throw new AppError(400, "The World ID result is missing or malformed.");
  }
  if (proof.action && proof.action !== config.world.action) {
    throw new AppError(400, `This proof is for action "${proof.action}", expected "${config.world.action}".`);
  }
  if (proof.environment && proof.environment !== config.world.env) {
    throw new AppError(400, `This proof is from the ${proof.environment} environment, but WORLD_ENV is ${config.world.env}.`, HINTS.invalid_proof);
  }
  const target = config.world.rpId ?? config.world.appId;
  if (!target) throw new ConfigError("WORLD_RP_ID", "Copy the RP ID from developer.world.org (SETUP.md, Step 7b).");

  const res = await fetch(`${config.world.verifyBaseUrl}/api/v4/verify/${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
  let body: VerifyResponse = {};
  try {
    body = (await res.json()) as VerifyResponse;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || body.success !== true) {
    const code = body.code ?? body.results?.find((r) => r.code)?.code ?? `http_${res.status}`;
    throw new AppError(400, `World ID verification failed (${code}).`, HINTS[code] ?? body.detail);
  }
  if (body.environment && body.environment !== config.world.env) {
    throw new AppError(400, `World verified a ${body.environment} proof, but WORLD_ENV is ${config.world.env}.`);
  }
  const raw = body.nullifier ?? body.results?.find((r) => r.nullifier)?.nullifier ?? proof.responses.find((r) => r.nullifier)?.nullifier;
  if (!raw) throw new AppError(400, "World verified the proof but returned no nullifier.");
  return { nullifier: normalizeNullifier(raw), environment: body.environment ?? config.world.env };
}

// ---------------- AgentBook (HUMAN_MODE=agentkit) ----------------

const AGENTBOOK_ADDRESS = (process.env.AGENTBOOK_ADDRESS || "0xA23aB2712eA7BBa896930544C7d6636a96b944dA") as `0x${string}`;
const agentBookAbi = parseAbi(["function lookupHuman(address agent) view returns (uint256)"]);
function makeWorldClient() {
  return createPublicClient({
    chain: worldchain,
    transport: http(config.world.worldChainRpcUrl || undefined, { timeout: 15_000 }),
  });
}
let worldClient: ReturnType<typeof makeWorldClient> | null = null;

/** The human behind an agent wallet in World's AgentBook, or null if the wallet is not registered. */
export async function agentBookHuman(address: string): Promise<string | null> {
  worldClient ??= makeWorldClient();
  const humanId = await worldClient.readContract({
    address: AGENTBOOK_ADDRESS,
    abi: agentBookAbi,
    functionName: "lookupHuman",
    args: [address as `0x${string}`],
  });
  return humanId === 0n ? null : humanId.toString(16);
}

/**
 * Is this buyer agent backed by a verified, unexpired human credential right now?
 * idkit: the person signed up with World ID and the credential is not expired (demo control F6 can expire it).
 * agentkit: additionally, the agent wallet must be registered in AgentBook.
 */
export async function isPersonCredentialValid(person: PersonRow, agent: AgentRow): Promise<boolean> {
  if (person.credential_expires_at && new Date(person.credential_expires_at).getTime() <= Date.now()) return false;
  if (person.mode === "dev") return config.devFakePersons;
  if (config.world.humanMode === "agentkit") {
    try {
      return (await agentBookHuman(agent.evm_address)) !== null;
    } catch (err) {
      log.warn("AgentBook lookup failed; treating buyer as unverified", { error: (err as Error).message });
      return false;
    }
  }
  return Boolean(person.world_nullifier);
}
