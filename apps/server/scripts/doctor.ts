/**
 * pnpm check-setup — checks every setting and balance and says, in plain English, what to fix.
 * pnpm check-setup --gen-secrets — fills empty secret lines in .env.
 */
import fs from "node:fs";
import { formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits6 } from "@ethernals/shared";
import { resolveModel } from "../src/brain";
import { config, ENV_PATH, normalizeEcdsaKey, writeEnvValue } from "../src/config";
import { generateSecret } from "../src/crypto";
import { getSpendAccount, listAgents, listPersons } from "../src/db";
import { getParentResolver, sepoliaPublic } from "../src/ens";
import { getBalances } from "../src/hedera";
import { facilitatorSupportsHedera } from "../src/payments";
import { verifierHealth } from "../src/verifier-client";
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
  if (config.zeroG.enabled()) ok("ZG_ENABLED=true: agents think on 0G Compute");
  else if (config.llm.apiKey) warn(`ZG_ENABLED is off: agents use Anthropic (${config.llm.model}). The demo must run on 0G.`);
  else fail("Neither 0G nor ANTHROPIC_API_KEY is set (agents will run in offline mode)", "Set up 0G Compute (SETUP.md)");

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

  title("0G Compute (agent brains)");
  if (!config.zeroG.enabled()) {
    info("Skipped: ZG_ENABLED is off.");
  } else {
    const base = config.zeroG.routerBaseUrl();
    try {
      const model = await resolveModel();
      ok(`Router ${base} (${config.zeroG.network()}): model ${model.id}`);
      if (!model.pricing) warn(`No pricing listed for ${model.id}, so receipts will show zero cost`);
    } catch (err) {
      fail(`Router ${base} is unreachable: ${(err as Error).message}`, "Check the URL. If the testnet Router fails everywhere, tell the team: mainnet needs a real 0G deposit (PLAN.md §8)");
    }
    const headers = (key: string) => ({ authorization: `Bearer ${key}` });
    const management = config.zeroG.managementKey();
    if (!management) {
      fail("ZG_MANAGEMENT_KEY is empty, so agents can't get their own keys", "Create one with scopes keys:create and keys:read (SETUP.md, 0G Compute)");
    } else {
      const res = await fetch(`${base}/api-keys`, { headers: headers(management) }).catch(() => null);
      res?.ok ? ok("Management key can list API keys") : fail(`Management key refused (HTTP ${res?.status ?? "no answer"})`, "It needs the scopes keys:create and keys:read");
      const balance = await fetch(`${base}/account/balance`, { headers: headers(management) }).catch(() => null);
      if (balance?.ok) info(`Router balance: ${JSON.stringify(await balance.json()).slice(0, 120)}`);
      else info("Router balance: not readable with this key (it needs account:read)");
    }
    config.zeroG.apiKeyOrNull() ? ok("Shared fallback key set") : fail("ZG_API_KEY is empty", "Create an API key at pc.testnet.0g.ai (SETUP.md, 0G Compute)");
  }

  title("Verifier and escrow (Sepolia)");
  try {
    const health = await verifierHealth();
    ok(`Verifier ${config.verifierService.url()}: ${health.mode} mode, validator ${health.validator}`);
    if (health.mode === "local") warn("Local mode is NOT isolated. Do not use it for the demo recording.");
    if (health.mode === "docker" && !health.dockerAvailable) fail("The verifier can't reach Docker", "Start Docker Desktop, then run pnpm verifier:image");
    const balance = await sepoliaPublic.getBalance({ address: health.validator });
    balance >= 10_000_000_000_000_000n
      ? ok(`Validator holds ${formatEther(balance)} Sepolia ETH`)
      : fail(`Validator has only ${formatEther(balance)} Sepolia ETH`, "It pays for settle() and ERC-8004 responses. Send it 0.05 ETH");
  } catch (err) {
    fail((err as Error).message, "Start it with: pnpm verifier:dev");
  }
  for (const [name, address] of [["TASK_ESCROW_ADDRESS", config.escrow.addressOrNull()], ["MOCK_USDC_ADDRESS", config.escrow.tokenOrNull()]] as const) {
    if (!address) {
      fail(`${name} is empty`, "Run: pnpm deploy:escrow");
      continue;
    }
    const code = await sepoliaPublic.getCode({ address: address as Hex }).catch(() => undefined);
    code && code !== "0x" ? ok(`${name} ${address} has a contract`) : fail(`No contract at ${name} ${address}`, "Run: pnpm deploy:escrow");
  }

  title("Spending controls");
  info(config.namera.enabled() ? "Namera is on" : "NAMERA_ENABLED=false: everyone uses the weaker direct guard");
  for (const person of listPersons()) {
    info(`${person.handle}: ${getSpendAccount(person.id) ? "Namera connected" : "direct guard (server-enforced, weaker)"}`);
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
