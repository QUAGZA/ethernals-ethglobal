/** pnpm ens:sync — rewrites every seller's x402 endpoint record to the current PUBLIC_BASE_URL. */
import { config } from "../src/config";
import { listAgents } from "../src/db";
import { syncEndpoints } from "../src/ens";
import { info, ok, run, title, warn } from "./_cli";

run(async () => {
  title(`Pointing agent endpoints at ${config.publicBaseUrl}`);
  if (config.publicBaseUrl.includes("localhost")) warn("PUBLIC_BASE_URL is localhost — fine for local testing, but judges can't open it.");
  const sellers = listAgents("seller").filter((a) => !a.arena_role);
  if (sellers.length === 0) {
    info("No agents yet. Create one on /provider first.");
    return;
  }
  await syncEndpoints(sellers, (m) => info(m));
  ok(`${sellers.length} agent(s) updated`);
});
