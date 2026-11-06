/** `pnpm deploy:escrow`: deploys MockUSDC and TaskEscrow(mockUsdc, validator) to Ethereum Sepolia and writes the addresses to .env. */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ENV_PATH, loadConfig } from "../src/config";
import { mockUsdcBytecode, mockUsdcFullAbi, taskEscrowBytecode, taskEscrowFullAbi } from "../src/generated/artifacts";

function writeEnvValue(key: string, value: string) {
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  fs.writeFileSync(ENV_PATH, pattern.test(current) ? current.replace(pattern, line) : `${current.replace(/\s*$/, "")}\n${line}\n`);
}

const cfg = loadConfig();
const raw = process.env.SEPOLIA_PRIVATE_KEY;
if (!raw || !process.env.SEPOLIA_RPC_URL) throw new Error("Set SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY in .env first (see SETUP.md).");
if (!cfg.privateKey) throw new Error("Run `pnpm verifier:setup` first: the escrow needs the validator address.");

const validator = privateKeyToAccount(cfg.privateKey).address;
const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`);
const transport = http(cfg.sepoliaRpcUrl);
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });

const usdcHash = await wallet.deployContract({ abi: mockUsdcFullAbi, bytecode: mockUsdcBytecode });
const usdc = (await pub.waitForTransactionReceipt({ hash: usdcHash })).contractAddress!;
const escrowHash = await wallet.deployContract({ abi: taskEscrowFullAbi, bytecode: taskEscrowBytecode, args: [usdc, validator] });
const escrow = (await pub.waitForTransactionReceipt({ hash: escrowHash })).contractAddress!;

writeEnvValue("MOCK_USDC_ADDRESS", usdc);
writeEnvValue("TASK_ESCROW_ADDRESS", escrow);
console.log(`MockUSDC   ${usdc}\n  https://sepolia.etherscan.io/address/${usdc}`);
console.log(`TaskEscrow ${escrow}\n  https://sepolia.etherscan.io/address/${escrow}`);
console.log(`Validator  ${validator}\nBoth addresses were written to .env. Share them with whoever builds the server side.`);
