/**
 * pnpm check-setup — checks every setting and balance and says, in plain English, what to fix.
 * pnpm check-setup --gen-secrets — fills empty secret lines in .env.
 */
import fs from "node:fs";
import { formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits6 } from "@ethernals/shared";
import { config, ENV_PATH, normalizeEcdsaKey, writeEnvValue } from "../src/config";
import { generateSecret } from "../src/crypto";
import { listAgents } from "../src/db";
import { getParentResolver, sepoliaPublic } from "../src/ens";
import { getBalances } from "../src/hedera";
import { facilitatorSupportsHedera } from "../src/payments";
import { bad, info, ok, parseArgs, run, title, warn } from "./_cli";

let problems = 0;
const fail = (msg: string, fix: string) => {
  problems++;
  bad(`${msg}\n      → ${fix}`);
};

run(async () => {
  const { flags } = parseArgs();
  if (!fs.existsSync(ENV_PATH)) {
    bad(`No .env file at ${ENV_PATH}.`);
    info("→ Run:  Copy-Item .env.example .env   (Mac: cp .env.example .env), then run pnpm check-setup --gen-secrets");
    process.exit(1);
  }

  if (flags["gen-secrets"]) {
    title("Generating secrets");
    for (const key of ["SESSION_SECRET", "PERSON_HASH_SECRET", "KEYSTORE_SECRET", "ADMIN_TOKEN"]) {
      if (process.env[key]?.trim()) ok(`${key} already set (kept)`);
      else {
        writeEnvValue(key, generateSecret());
        ok(`${key} generated`);
      }
    }
  }

  title("Basics");
  for (const key of ["SESSION_SECRET", "PERSON_HASH_SECRET", "KEYSTORE_SECRET"]) {
    process.env[key]?.trim() ? ok(`${key} is set`) : fail(`${key} is empty`, "Run: pnpm check-setup --gen-secrets");
  }
  config.devFakePersons
    ? warn("DEV_FAKE_PERSONS=true — people are NOT verified. Set it to false before the demo.")
    : ok("DEV_FAKE_PERSONS is off");
  config.llm.apiKey
    ? ok(`AI key set (model ${config.llm.model})`)
    : fail("ANTHROPIC_API_KEY is empty (agents will run in offline mode)", "Create a key at console.anthropic.com (SETUP.md Step 8)");

  title("World ID");
  config.world.appId ? ok(`App ID ${config.world.appId}`) : fail("WORLD_APP_ID is empty", "SETUP.md Step 7b");
  config.world.rpId ? ok(`RP ID ${config.world.rpId}`) : fail("WORLD_RP_ID is empty", "SETUP.md Step 7b");
  config.world.rpSigningKey ? ok("RP signing key set") : fail("WORLD_RP_SIGNING_KEY is empty", "SETUP.md Step 7b (shown only once in the portal)");
  info(`Environment: ${config.world.env} · action: ${config.world.action} · mode: ${config.world.humanMode}`);
  if (config.world.env === "staging") info("Staging uses the World ID Simulator: https://simulator.worldcoin.org");

  title("Hedera (payments + ledger)");
  try {
    const operator = config.hedera.operatorId();
    const evm = privateKeyToAccount(normalizeEcdsaKey(config.hedera.operatorKey())).address;
    const b = await getBalances(operator);
    ok(`Operator ${operator} (EVM ${evm})`);
    Number(b.hbar) >= 20 ? ok(`${b.hbar} HBAR`) : fail(`Only ${b.hbar} HBAR`, "Claim test HBAR at portal.hedera.com");
    if (config.hedera.paymentAsset === "USDC") {
      if (!b.usdcAssociated) fail("Operator is not associated with USDC", "Run: pnpm hedera:setup");
      else if (b.usdcUnits < 3_000_000n) fail(`Only ${formatUnits6(b.usdcUnits)} USDC`, "Get 10 test USDC at faucet.circle.com → Hedera Testnet");
      else ok(`${formatUnits6(b.usdcUnits)} USDC`);
    }
  } catch (err) {
    fail((err as Error).message, "SETUP.md Step 6");
  }
  const fac = await facilitatorSupportsHedera();
  fac.ok ? ok(`Facilitator ${config.hedera.facilitatorUrl}: ${fac.detail}`) : fail(`Facilitator: ${fac.detail}`, "Try X402_FACILITATOR_URL=https://api.testnet.blocky402.com (SETUP.md Step 9)");
  config.hedera.ledgerAddressOrNull()
    ? ok(`HireLedger at ${config.hedera.ledgerAddressOrNull()}`)
    : fail("HIRE_LEDGER_ADDRESS is empty", "Run: pnpm deploy:ledger");

  title("Sepolia (ENS + Arena)");
  try {
    const address = privateKeyToAccount(normalizeEcdsaKey(config.sepolia.privateKey())).address;
    config.sepolia.rpcUrl();
    const balance = await sepoliaPublic.getBalance({ address });
    balance >= 50_000_000_000_000_000n
      ? ok(`Wallet ${address}: ${formatEther(balance)} ETH`)
      : fail(`Wallet ${address} has only ${formatEther(balance)} Sepolia ETH`, "Aim for about 0.2 ETH (SETUP.md Step 4d)");
  } catch (err) {
    fail((err as Error).message, "SETUP.md Step 4");
  }
  try {
    const parent = config.ens.parent();
    const resolver = await getParentResolver();
    const ours = process.env.ENS_RESOLVER_ADDRESS;
    if (!ours) fail(`${parent}: resolver not set up`, "Run: pnpm ens:setup");
    else if (resolver?.toLowerCase() === ours.toLowerCase()) ok(`${parent} → resolver ${ours}`);
    else fail(`${parent} points at ${resolver ?? "no resolver"}, not ${ours}`, "Run: pnpm ens:setup");
  } catch (err) {
    fail((err as Error).message, "SETUP.md Step 5");
  }

  if (config.world.humanMode === "agentkit") {
    title("AgentBook registration (HUMAN_MODE=agentkit)");
    const { agentBookHuman } = await import("../src/identity");
    for (const agent of listAgents().filter((a) => !a.arena_role)) {
      const human = await agentBookHuman(agent.evm_address).catch(() => null);
      human ? ok(`${agent.ens_name} registered`) : warn(`${agent.ens_name} not registered → npx @worldcoin/agentkit-cli register ${agent.evm_address}`);
    }
  }

  title(problems === 0 ? "All good. Start the app with: pnpm dev" : `${problems} thing(s) to fix above.`);
  if (problems > 0) process.exitCode = 1;
});
