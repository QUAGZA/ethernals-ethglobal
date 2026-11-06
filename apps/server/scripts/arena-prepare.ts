/**
 * pnpm arena:prepare -- --attacker <handle> [--other <handle>] [--target summarize]
 * Prepares both sides of the Arena ahead of the demo (accounts, gas, USDC). Safe to re-run.
 */
import { config } from "../src/config";
import { prepareArena } from "../src/arena";
import { info, ok, parseArgs, run, title } from "./_cli";

run(async () => {
  const { flags } = parseArgs();
  const attacker = typeof flags.attacker === "string" ? flags.attacker : null;
  if (!attacker) {
    throw new Error("Tell me who the attacker is: pnpm arena:prepare -- --attacker <handle of the summarize agent's owner>");
  }
  title(`Preparing the Arena (${config.arena.fakeReviewers} fake reviewers, ${config.arena.farmHires} farm hires)`);
  info("Tip: keep pnpm dev idle while this runs; it sends many transactions.");
  await prepareArena({
    attackerHandle: attacker,
    otherHandle: typeof flags.other === "string" ? flags.other : null,
    targetLabel: typeof flags.target === "string" ? flags.target : "summarize",
    onStep: (m) => info(m),
  });
  ok("Arena prepared. Open /arena and press the attack buttons.");
});
