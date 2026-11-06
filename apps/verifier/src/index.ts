import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { viemChain } from "./chain";
import { Store } from "./store";
import { cloneRepo } from "./pipeline";
import { prepareDemoRepo } from "./demo";

const cfg = loadConfig();
if (!cfg.privateKey) {
  console.error("VERIFIER_PRIVATE_KEY is empty. Run `pnpm verifier:setup` to generate a validator key and token.");
  process.exit(1);
}
if (!cfg.token) {
  console.error("VERIFIER_TOKEN is empty. Run `pnpm verifier:setup`.");
  process.exit(1);
}
if (cfg.mode === "local") {
  console.warn("\n  !!! VERIFIER_MODE=local: tests run directly on this machine with NO isolation. Development only. !!!\n");
}

const account = privateKeyToAccount(cfg.privateKey);
const chain = cfg.escrowAddress
  ? viemChain({ rpcUrl: cfg.sepoliaRpcUrl, account, escrow: cfg.escrowAddress, validationRegistry: cfg.validationRegistry })
  : null;
if (!chain) console.warn("TASK_ESCROW_ADDRESS is empty: jobs are graded and signed but nothing is settled on-chain.");

const app = createApp({
  token: cfg.token,
  validator: account.address,
  escrow: cfg.escrowAddress,
  pipeline: {
    store: new Store(cfg.dataDir),
    account,
    chain,
    mode: cfg.mode,
    image: cfg.image,
    timeoutSeconds: cfg.timeoutSeconds,
    publicUrl: cfg.publicUrl,
    emit: () => undefined,
    // "demo://slugify" is the bundled demo task: no GitHub push needed. Turn off with VERIFIER_ALLOW_DEMO_REPO=0.
    prepareRepo: (dir, req, log) =>
      req.repoUrl === "demo://slugify" && process.env.VERIFIER_ALLOW_DEMO_REPO !== "0"
        ? prepareDemoRepo(dir, req, log)
        : cloneRepo(dir, req, log),
  },
});

app.listen(cfg.port, () => {
  console.log(`verifier listening on :${cfg.port} (mode=${cfg.mode}, validator=${account.address})`);
});
