/**
 * Loads `.env` from the repo root and exposes typed configuration.
 * Missing values throw a ConfigError with a plain-English fix that points at SETUP.md.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function findUp(fileName: string, start = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const workspaceFile = findUp("pnpm-workspace.yaml");
export const ROOT_DIR = workspaceFile ? path.dirname(workspaceFile) : process.cwd();
export const ENV_PATH = path.join(ROOT_DIR, ".env");
dotenv.config({ path: ENV_PATH, quiet: true });

export class ConfigError extends Error {
  constructor(
    public readonly key: string,
    public readonly hint: string,
  ) {
    super(`Missing ${key} in .env. ${hint}`);
    this.name = "ConfigError";
  }
}

function str(key: string, fallback = ""): string {
  const value = process.env[key];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function bool(key: string, fallback: boolean): boolean {
  const value = str(key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(key: string, fallback: number): number {
  const value = Number.parseInt(str(key), 10);
  return Number.isFinite(value) ? value : fallback;
}

/** Normalizes an ECDSA private key from the Hedera portal or MetaMask into 0x + 64 hex chars. */
export function normalizeEcdsaKey(raw: string): `0x${string}` {
  let hex = raw.trim().replace(/^0x/i, "");
  // DER-encoded secp256k1 private key (Hedera portal "DER" form): take the last 32 bytes.
  const derPrefix = "3030020100300706052b8104000a04220420";
  if (hex.toLowerCase().startsWith(derPrefix)) hex = hex.slice(derPrefix.length);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Private key must be 64 hex characters (optionally starting with 0x).");
  }
  return `0x${hex.toLowerCase()}`;
}

const SETUP = "See SETUP.md";

export const config = {
  appName: str("APP_NAME", "Ethernals"),
  publicBaseUrl: str("PUBLIC_BASE_URL", "http://localhost:3000").replace(/\/+$/, ""),
  serverPort: int("SERVER_PORT", 4000),
  /** Where the server reaches its own x402 endpoints (always local, never through a tunnel). */
  internalBaseUrl: str("INTERNAL_BASE_URL", `http://127.0.0.1:${int("SERVER_PORT", 4000)}`),
  demoMode: bool("DEMO_MODE", true),
  devFakePersons: bool("DEV_FAKE_PERSONS", false),
  production: process.env.NODE_ENV === "production",

  secrets: {
    session: () => need("SESSION_SECRET", `Run: pnpm check-setup --gen-secrets (${SETUP}, Step 3).`),
    personHash: () => need("PERSON_HASH_SECRET", `Run: pnpm check-setup --gen-secrets (${SETUP}, Step 3).`),
    keystore: () => need("KEYSTORE_SECRET", `Run: pnpm check-setup --gen-secrets (${SETUP}, Step 3).`),
    admin: () => str("ADMIN_TOKEN"),
  },

  databasePath: path.resolve(ROOT_DIR, str("DATABASE_PATH", "./data/ethernals.db")),

  llm: {
    apiKey: str("ANTHROPIC_API_KEY"),
    model: str("LLM_MODEL", "claude-haiku-5-5"),
  },

  world: {
    appId: str("WORLD_APP_ID"),
    rpId: str("WORLD_RP_ID") || null,
    rpSigningKey: str("WORLD_RP_SIGNING_KEY") || null,
    action: str("WORLD_ACTION", "ethernals-signup"),
    env: (str("WORLD_ENV", "staging") === "production" ? "production" : "staging") as "staging" | "production",
    humanMode: (str("HUMAN_MODE", "idkit") === "agentkit" ? "agentkit" : "idkit") as "idkit" | "agentkit",
    worldChainRpcUrl: str("WORLD_CHAIN_RPC_URL"),
    verifyBaseUrl: str("WORLD_VERIFY_BASE_URL", "https://developer.world.org"),
  },

  hedera: {
    network: "testnet" as const,
    caip2: "hedera:testnet" as const,
    operatorId: () => need("HEDERA_OPERATOR_ID", `Copy the Account ID from portal.hedera.com (${SETUP}, Step 6).`),
    operatorKey: () =>
      need("HEDERA_OPERATOR_KEY", `Copy the HEX Encoded Private Key from portal.hedera.com (${SETUP}, Step 6).`),
    rpcUrl: str("HEDERA_RPC_URL", "https://testnet.hashio.io/api"),
    mirrorUrl: str("HEDERA_MIRROR_URL", "https://testnet.mirrornode.hedera.com").replace(/\/+$/, ""),
    paymentAsset: (str("PAYMENT_ASSET", "USDC").toUpperCase() === "HBAR" ? "HBAR" : "USDC") as "USDC" | "HBAR",
    usdcTokenId: str("HEDERA_USDC_TOKEN_ID", "0.0.429274"),
    facilitatorUrl: str("X402_FACILITATOR_URL", "https://x402.org/facilitator").replace(/\/+$/, ""),
    ledgerAddress: () =>
      need("HIRE_LEDGER_ADDRESS", "Run: pnpm deploy:ledger (it writes this value for you).") as `0x${string}`,
    ledgerAddressOrNull: () => (str("HIRE_LEDGER_ADDRESS") || null) as `0x${string}` | null,
    buyerStartingUsdc: str("BUYER_STARTING_USDC", "1.00"),
    /** Float for seller agents so they can pay sub-hires before their own first payment settles. */
    sellerStartingUsdc: str("SELLER_STARTING_USDC", "0.20"),
    agentStartingHbar: str("AGENT_STARTING_HBAR", "2"),
  },

  sepolia: {
    rpcUrl: () => need("SEPOLIA_RPC_URL", `Create a free Sepolia RPC URL at alchemy.com (${SETUP}, Step 4e).`),
    privateKey: () => need("SEPOLIA_PRIVATE_KEY", `Export your MetaMask test wallet key (${SETUP}, Step 4c).`),
    publicRpcUrl: str("PUBLIC_SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
  },

  ens: {
    parent: () => need("ENS_PARENT_NAME", `Register a name on Sepolia ENS and put it here (${SETUP}, Step 5).`),
    parentOrNull: () => str("ENS_PARENT_NAME") || null,
    universalResolver: (str("ENS_UNIVERSAL_RESOLVER") || null) as `0x${string}` | null,
  },

  erc8004: {
    identity: str("ERC8004_IDENTITY_REGISTRY", "0x8004A818BFB912233c491871b3d84c89A494BD9e") as `0x${string}`,
    reputation: str("ERC8004_REPUTATION_REGISTRY", "0x8004B663056A597Dffe9eCcC1965A193B7388713") as `0x${string}`,
  },

  /** Sandbox verifier (apps/verifier) and the Sepolia escrow it settles. */
  proofs: {
    verifierUrl: str("VERIFIER_URL", "http://127.0.0.1:4100").replace(/\/+$/, ""),
    verifierToken: str("VERIFIER_TOKEN"),
    escrow: (str("TASK_ESCROW_ADDRESS") || null) as `0x${string}` | null,
  },

  /** 0G Compute Router: an OpenAI-compatible API where agents think (docs.0g.ai > Compute > Router). */
  zg: {
    enabled: bool("ZG_ENABLED", false),
    network: (str("ZG_NETWORK", "testnet") === "mainnet" ? "mainnet" : "testnet") as "testnet" | "mainnet",
    baseUrl: str("ZG_ROUTER_BASE_URL", "https://router-api-testnet.integratenetwork.work/v1").replace(/\/+$/, ""),
    apiKey: str("ZG_API_KEY"),
    managementKey: str("ZG_MANAGEMENT_KEY"),
    model: str("ZG_MODEL"),
  },

  arena: {
    fakeReviewers: int("ARENA_FAKE_REVIEWERS", 20),
    farmHires: int("ARENA_FARM_HIRES", 20),
    baseMainnetRpcUrl: str("BASE_MAINNET_RPC_URL", "https://mainnet.base.org"),
    ethUsdPrice: Number.parseFloat(str("ETH_USD_PRICE", "3500")) || 3500,
  },
};

export function need(key: string, hint: string): string {
  const value = str(key);
  if (!value) throw new ConfigError(key, hint);
  return value;
}

/** Writes or replaces KEY=value in the root .env file (used by deploy scripts). */
export function writeEnvValue(key: string, value: string): void {
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(current) ? current.replace(pattern, line) : `${current.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, next);
  process.env[key] = value;
}
