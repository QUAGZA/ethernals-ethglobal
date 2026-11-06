/**
 * Creates the Duel's two specialists, spun up with the full 0G flow:
 *   pnpm --filter @ethernals/server exec tsx scripts/seed-coders.ts --strong <providerHandle> --weak <otherHandle>
 * Use two different providers, and neither may be the client in the demo, or the votes won't count.
 */
import { createSellerAgent } from "../src/agents";
import { findPersonByHandle, getAgentByLabel, type PersonRow } from "../src/db";
import { subscribe } from "../src/events";
import { info, ok, parseArgs, run, title, warn } from "./_cli";

const ATTEMPT_FEE = "0.05";

function need(handle: string | true | undefined, flag: string): PersonRow {
  if (typeof handle !== "string") throw new Error(`Say who owns the agent: --${flag} <handle>. They must have signed up first.`);
  const person = findPersonByHandle(handle);
  if (!person) throw new Error(`No person "${handle}". Sign them up on /signup first.`);
  return person;
}

run(async () => {
  const { flags } = parseArgs();
  const strong = need(flags.strong, "strong");
  const weak = need(flags.weak, "weak");
  if (strong.id === weak.id) throw new Error("Use two different providers.");

  subscribe((message) => {
    if (message.type === "agent.born") info(`  ${message.data.message}`);
  });

  const agents = [
    { label: "fixer", owner: strong, strategy: "careful", description: "Careful Python bug fixer. Paid only when hidden tests pass." },
    { label: "weak-fixer", owner: weak, strategy: "weak", description: "Weak demo agent: patches the obvious case and misses the edge cases." },
  ] as const;

  for (const { label, owner, strategy, description } of agents) {
    title(`${label} (owned by ${owner.handle})`);
    if (getAgentByLabel(label)) {
      warn(`${label} already exists (kept)`);
      continue;
    }
    const agent = await createSellerAgent(owner, { label, taskType: "code-fix", basePrice: ATTEMPT_FEE, description }, (step) => info(step), strategy);
    ok(`${agent.ens_name} is live`);
  }
  title("Done. Open /duel to start a duel.");
});
