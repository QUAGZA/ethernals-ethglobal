import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { Hex } from "@ethernals/shared";

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

const str = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
};

export interface VerifierConfig {
  port: number;
  publicUrl: string;
  token: string;
  privateKey: Hex | null;
  mode: "docker" | "local";
  image: string;
  timeoutSeconds: number;
  dataDir: string;
  sepoliaRpcUrl: string;
  escrowAddress: Hex | null;
  validationRegistry: Hex | null;
}

export function loadConfig(): VerifierConfig {
  const mode = str("VERIFIER_MODE", "docker") === "local" ? "local" : "docker";
  const pk = str("VERIFIER_PRIVATE_KEY");
  return {
    port: Number(str("VERIFIER_PORT", "4100")),
    publicUrl: str("VERIFIER_PUBLIC_URL", "http://localhost:4100").replace(/\/$/, ""),
    token: str("VERIFIER_TOKEN"),
    privateKey: pk ? ((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex) : null,
    mode,
    image: str("VERIFIER_IMAGE", "ethernals-pytest:latest"),
    timeoutSeconds: Number(str("VERIFIER_TIMEOUT_SECONDS", "120")),
    dataDir: path.resolve(ROOT_DIR, str("VERIFIER_DATA_DIR", "./data/verifier")),
    sepoliaRpcUrl: str("SEPOLIA_RPC_URL", str("PUBLIC_SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")),
    escrowAddress: (str("TASK_ESCROW_ADDRESS") || null) as Hex | null,
    validationRegistry: (str("ERC8004_VALIDATION_REGISTRY") || null) as Hex | null,
  };
}
