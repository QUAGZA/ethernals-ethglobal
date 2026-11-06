/**
 * Person hashes, provider keys, key encryption at rest and session tokens.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

/** Per-agent person hash: equal only for the same person on the same agent (PRD §6.1). */
export function personHash(personId: string, agentKey: string): `0x${string}` {
  const mac = createHmac("sha256", config.secrets.personHash()).update(`${personId}|${agentKey.toLowerCase()}`).digest("hex");
  return `0x${mac}`;
}

/** Public provider key: groups all agents of one provider. */
export function providerKey(personId: string): `0x${string}` {
  const mac = createHmac("sha256", config.secrets.personHash()).update(`${personId}|provider`).digest("hex");
  return `0x${mac}`;
}

function keystoreKey(): Buffer {
  return createHash("sha256").update(config.secrets.keystore()).digest();
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keystoreKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keystoreKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function sha256Hex(value: string): `0x${string}` {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

const SESSION_DAYS = 3;

export function createSessionToken(personId: string): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const body = `${personId}.${expires}`;
  const sig = createHmac("sha256", config.secrets.session()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [personId, expires, sig] = parts;
  const expected = createHmac("sha256", config.secrets.session()).update(`${personId}.${expires}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expires) < Date.now()) return null;
  return personId;
}

export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * The agent's Hedera key, derived from the platform root secret and its ENS name: nothing per-agent has to be stored,
 * and any host with the same root secret can operate the agent. (The root secret is KEYSTORE_SECRET.)
 */
export function deriveAgentKeyHex(ensName: string): `0x${string}` {
  for (let i = 0; i < 8; i++) {
    const raw = Buffer.from(hkdfSync("sha256", config.secrets.keystore(), "ethernals-agent-key-v1", `${ensName.toLowerCase()}|${i}`, 32));
    const n = BigInt(`0x${raw.toString("hex")}`);
    if (n > 0n && n < SECP256K1_N) return `0x${raw.toString("hex")}`;
  }
  throw new Error("Could not derive a valid agent key.");
}

/** HMAC of a World ID nullifier: proves "same human" on-chain without publishing the nullifier. */
export function nullifierHash(nullifier: string): string {
  return createHmac("sha256", config.secrets.personHash()).update(`nullifier|${nullifier}`).digest("hex");
}
