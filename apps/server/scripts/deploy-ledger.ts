/** pnpm deploy:ledger — deploys HireLedger to Hedera testnet and writes HIRE_LEDGER_ADDRESS into .env. */
import { hashscanContractUrl, hashscanEvmTxUrl } from "@ethernals/shared";
import { writeEnvValue } from "../src/config";
import { deployLedger } from "../src/ledger";
import { info, ok, run, title } from "./_cli";

run(async () => {
  title("Deploying the HireLedger to Hedera testnet...");
  const { address, txHash } = await deployLedger();
  writeEnvValue("HIRE_LEDGER_ADDRESS", address);
  ok(`HireLedger deployed at ${address}`);
  info(`Contract: ${hashscanContractUrl(address)}`);
  info(`Deploy tx: ${hashscanEvmTxUrl(txHash)}`);
  ok("Saved HIRE_LEDGER_ADDRESS in .env");
  info("Next: pnpm ens:setup");
});
