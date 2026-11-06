/** pnpm hedera:setup — lets the operator account hold test USDC, then prints its balances. */
import { formatUnits6 } from "@ethernals/shared";
import { config } from "../src/config";
import { associateUsdc, getBalances, parseEcdsaKey, sleep } from "../src/hedera";
import { info, ok, run, title, warn } from "./_cli";

run(async () => {
  const operator = config.hedera.operatorId();
  title(`Hedera operator ${operator}`);
  if (config.hedera.paymentAsset === "USDC") {
    const result = await associateUsdc(operator, parseEcdsaKey(config.hedera.operatorKey()));
    ok(result === "associated" ? `USDC (${config.hedera.usdcTokenId}) associated` : "USDC was already associated");
    await sleep(4000); // let the mirror node catch up
  }
  const b = await getBalances(operator);
  ok(`${b.hbar} HBAR`);
  if (config.hedera.paymentAsset === "USDC") {
    b.usdcUnits > 0n
      ? ok(`${formatUnits6(b.usdcUnits)} USDC`)
      : warn("0 USDC — now get 10 test USDC at faucet.circle.com (USDC → Hedera Testnet → paste " + operator + ")");
  }
  info("Next: pnpm deploy:ledger");
});
