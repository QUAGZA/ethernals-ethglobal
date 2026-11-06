/** `pnpm verifier:setup`: idempotent. Fills VERIFIER_PRIVATE_KEY and VERIFIER_TOKEN in .env, checks Docker, and funds the validator. */
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ENV_PATH, loadConfig } from "../src/config";

function writeEnvValue(key: string, value: string) {
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  fs.writeFileSync(ENV_PATH, pattern.test(current) ? current.replace(pattern, line) : `${current.replace(/\s*$/, "")}\n${line}\n`);
  process.env[key] = value;
}

let cfg = loadConfig();
if (!cfg.privateKey) {
  writeEnvValue("VERIFIER_PRIVATE_KEY", generatePrivateKey());
  console.log("Created a validator key and saved it to .env (VERIFIER_PRIVATE_KEY).");
}
if (!cfg.token) {
  writeEnvValue("VERIFIER_TOKEN", crypto.randomBytes(32).toString("base64url"));
  console.log("Created a verifier token and saved it to .env (VERIFIER_TOKEN).");
}
cfg = loadConfig();
const validator = privateKeyToAccount(cfg.privateKey!);
console.log(`Validator address: ${validator.address}`);

const docker = spawnSync("docker", ["image", "inspect", cfg.image], { encoding: "utf8" });
const dockerOk = spawnSync("docker", ["version"], { encoding: "utf8" }).status === 0;
console.log(dockerOk ? `Docker: running.` : `Docker: NOT running. Start Docker Desktop, or set VERIFIER_MODE=local for development.`);
if (dockerOk && docker.status !== 0) console.log(`Sandbox image ${cfg.image} is missing. Build it with: pnpm verifier:image`);

const funder = process.env.SEPOLIA_PRIVATE_KEY;
if (!funder || !process.env.SEPOLIA_RPC_URL) {
  console.log("Skipping funding: SEPOLIA_PRIVATE_KEY / SEPOLIA_RPC_URL are not set. Send ~0.03 Sepolia ETH to the validator by hand.");
} else {
  const transport = http(cfg.sepoliaRpcUrl);
  const pub = createPublicClient({ chain: sepolia, transport });
  const bal = await pub.getBalance({ address: validator.address });
  console.log(`Validator balance: ${formatEther(bal)} ETH`);
  if (bal < parseEther("0.01")) {
    const key = (funder.startsWith("0x") ? funder : `0x${funder}`) as `0x${string}`;
    const wallet = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(key) });
    const hash = await wallet.sendTransaction({ to: validator.address, value: parseEther("0.03") });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`Sent 0.03 ETH to the validator: https://sepolia.etherscan.io/tx/${hash}`);
  }
}
console.log("\nNext: pnpm deploy:escrow");
