/**
 * pnpm demo:reset — a clean slate for the demo: a fresh HireLedger (every score back to 3.00), agents
 * re-registered on it, ENS records reset, buyer agents topped up, and hires, tasks, duels, receipts, spend events and
 * Arena state cleared. People, their agents, Hedera accounts and 0G brain keys are kept. Stop `pnpm dev` first.
 */
import { namehash } from "viem/ens";
import { formatUnits6, parseUnits6 } from "@ethernals/shared";
import { providerKeyShort } from "../src/agents";
import { config, writeEnvValue } from "../src/config";
import { personHash, providerKey } from "../src/crypto";
import { clearTaskData, getDb, getPerson, listAgents, resetBrainCredit, updateAgent } from "../src/db";
import { initialRecords, setRecords } from "../src/ens";
import { fundFromOperator, getPaymentBalanceUnits } from "../src/hedera";
import { deployLedger, registerAgentOnLedger } from "../src/ledger";
import { info, ok, run, title, warn } from "./_cli";

run(async () => {
  const up = await fetch(`${config.internalBaseUrl}/api/health`).catch(() => null);
  if (up?.ok) throw new Error("The server is running. Stop pnpm dev first (Ctrl+C in its window), then run pnpm demo:reset again.");

  title("1/4 Fresh HireLedger");
  const { address } = await deployLedger();
  writeEnvValue("HIRE_LEDGER_ADDRESS", address);
  ok(`HireLedger ${address}`);

  title("2/4 Clearing hires and Arena state");
  const db = getDb();
  db.exec("DELETE FROM mandates; DELETE FROM hires; DELETE FROM arena_wallets; DELETE FROM kv;");
  const farm = listAgents().filter((a) => a.arena_role);
  db.prepare("DELETE FROM agents WHERE arena_role IS NOT NULL").run();
  ok(`Cleared (removed ${farm.length} Arena farm agents; run pnpm arena:prepare again)`);
  clearTaskData();
  resetBrainCredit(config.zeroG.seedCreditNeuron());
  ok("Cleared tasks, duels, receipts and spend events; brain credit back to the seed (the escrow and old tasks stay on-chain)");

  title("3/4 Re-registering sellers and resetting ENS");
  for (const agent of listAgents("seller")) {
    const person = getPerson(agent.person_id)!;
    const key = namehash(agent.ens_name);
    await registerAgentOnLedger({
      agentKey: key,
      providerKey: providerKey(person.id),
      providerPersonHash: personHash(person.id, key),
      basePrice: BigInt(agent.base_price),
    });
    updateAgent(agent.key, { ledger_registered: 1 });
    try {
      await setRecords(agent.ens_name, initialRecords(agent, providerKeyShort(person.id)));
      ok(`${agent.ens_name}: ledger + ENS reset (score 3.00, price ${formatUnits6(BigInt(agent.base_price))})`);
    } catch (err) {
      warn(`${agent.ens_name}: ledger reset, ENS failed (${(err as Error).message}) — run pnpm ens:sync later`);
    }
  }

  title("4/4 Topping up buyer agents");
  const target = parseUnits6(config.hedera.buyerStartingUsdc);
  for (const buyer of listAgents("buyer")) {
    const balance = await getPaymentBalanceUnits(buyer.hedera_account_id).catch(() => target);
    if (balance < target) {
      await fundFromOperator(buyer.hedera_account_id, target - balance);
      info(`${buyer.ens_name} +${formatUnits6(target - balance)}`);
    }
    updateAgent(buyer.key, { budget_remaining: target.toString() });
  }
  ok("Done. Start the app again with: pnpm dev");
});
