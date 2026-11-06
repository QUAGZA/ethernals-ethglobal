/** `pnpm zg:check`: is 0G reachable, which model will agents use, and does one real call work (prints the request id). */
import { brainEnabled, listModels, resolveModel, think } from "../src/brain";
import { config } from "../src/config";

console.log(`0G network: ${config.zg.network}`);
console.log(`Router:     ${config.zg.baseUrl}`);
console.log(`ZG_ENABLED: ${config.zg.enabled}   ZG_API_KEY: ${config.zg.apiKey ? "set" : "EMPTY"}   ZG_MANAGEMENT_KEY: ${config.zg.managementKey ? "set" : "empty (optional)"}`);

try {
  const models = await listModels(true);
  console.log(`\nReachable. ${models.length} models: ${models.map((m) => m.id).join(", ")}`);
  const m = await resolveModel();
  console.log(`Agents will use: ${m.id}`);
} catch (e) {
  const err = e as Error & { hint?: string };
  console.error(`\nNOT reachable: ${err.message}`);
  if (err.hint) console.error(`  ${err.hint}`);
  process.exit(1);
}

if (!brainEnabled()) {
  console.log("\nSkipping the test call: set ZG_ENABLED=true and ZG_API_KEY in .env.");
  process.exit(0);
}
try {
  const t = await think({ agent: "zg-check", purpose: "check", system: "Reply with one short sentence.", user: "Say hello from the 0G network.", maxTokens: 2000 });
  console.log(`\nTest call OK: "${t.text.slice(0, 120)}"`);
  console.log(`  request id: ${t.receipt.requestId}`);
  console.log(`  provider:   ${t.receipt.provider ?? "(not reported)"}`);
  console.log(`  tokens:     ${t.receipt.promptTokens} in / ${t.receipt.completionTokens} out, cost ${t.receipt.costNeuron} neuron`);
} catch (e) {
  const err = e as Error & { hint?: string };
  console.error(`\nTest call FAILED: ${err.message}`);
  if (err.hint) console.error(`  ${err.hint}`);
  process.exit(1);
}
