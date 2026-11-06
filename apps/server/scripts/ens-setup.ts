/** pnpm ens:setup — gives the ENS parent name a Permissioned Resolver the platform wallet controls. */
import { ensAppUrl } from "@ethernals/shared";
import { config } from "../src/config";
import { platformSepoliaAddress, setupParentResolver } from "../src/ens";
import { info, ok, run, title } from "./_cli";

run(async () => {
  const parent = config.ens.parent();
  title(`Setting up ${parent} on Sepolia (ENSv2)`);
  info(`Platform wallet: ${platformSepoliaAddress()}`);
  const resolver = await setupParentResolver((m) => info(m));
  ok(`Resolver ${resolver}`);
  ok("ENS ready");
  info(`Check it in the ENS app: ${ensAppUrl(parent)}`);
  info("Next: pnpm dev");
});
